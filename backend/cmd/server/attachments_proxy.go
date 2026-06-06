package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	maxOutgoingAttachmentBytes        int64 = 50 * 1024 * 1024
	maxOutgoingMultipartRequestBytes int64 = maxOutgoingAttachmentBytes + 5*1024*1024
)

type outgoingAttachment struct {
	Filename    string
	ContentType string
	Data        []byte
}

func init() {
	startAttachmentProxyIfEnabled()
}

func startAttachmentProxyIfEnabled() {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("MAILADMIN_DISABLE_ATTACHMENT_PROXY")), "1") || strings.HasSuffix(os.Args[0], ".test") {
		return
	}

	cfg, err := loadConfig()
	if err != nil {
		return
	}

	externalAddr := strings.TrimSpace(cfg.AppAddr)
	if externalAddr == "" {
		return
	}
	internalAddr := strings.TrimSpace(os.Getenv("MAILADMIN_INTERNAL_APP_ADDR"))
	if internalAddr == "" {
		internalAddr = "127.0.0.1:18081"
	}
	if externalAddr == internalAddr {
		return
	}

	_ = os.Setenv("APP_ADDR", internalAddr)

	logger := log.New(os.Stdout, "[mailadmin-attachment-proxy] ", log.LstdFlags|log.LUTC)
	encKey := sha256.Sum256([]byte(cfg.WebmailAccountEncKey))
	proxyServer := &Server{cfg: cfg, logger: logger, loginAttempts: map[string]loginAttempt{}, webmailEncKey: encKey}
	targetURL := &url.URL{Scheme: "http", Host: internalAddr}
	reverseProxy := httputil.NewSingleHostReverseProxy(targetURL)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/mail/send" && isMultipartFormRequest(r) {
			proxyServer.handleMailSendMultipart(w, r)
			return
		}
		reverseProxy.ServeHTTP(w, r)
	})

	go func() {
		server := &http.Server{
			Addr:              externalAddr,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       10 * time.Minute,
			WriteTimeout:      10 * time.Minute,
			IdleTimeout:       120 * time.Second,
		}
		logger.Printf("attachment proxy listening on %s and forwarding to %s", externalAddr, internalAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Printf("attachment proxy stopped: %v", err)
		}
	}()
}

func isMultipartFormRequest(r *http.Request) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type"))), "multipart/form-data")
}

func (s *Server) handleMailSendMultipart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	if err := s.ensurePortalSessionID(w, sess); err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxOutgoingMultipartRequestBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid multipart form or attachment size exceeds 50MB")
		return
	}

	accountID := strings.TrimSpace(r.FormValue("account_id"))
	to := r.FormValue("to")
	cc := r.FormValue("cc")
	bcc := r.FormValue("bcc")
	subject := r.FormValue("subject")
	body := r.FormValue("body")

	account, password, err := s.resolveWebmailAccount(r.Context(), sess, accountID)
	if err != nil {
		if err.Error() == "account not found" {
			writeErr(w, 404, "NOT_FOUND", "account not found")
		} else if err.Error() == "mailbox session invalid" {
			writeErr(w, 401, "AUTH_FAILED", err.Error())
		} else {
			writeErr(w, 500, "DB_ERROR", err.Error())
		}
		return
	}

	attachments, err := readOutgoingAttachments(r)
	if err != nil {
		writeErr(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	sentSaved, warning, err := s.portalSendMailWithAttachments(r.Context(), account.Email, password, to, cc, bcc, subject, body, attachments)
	if err != nil {
		writeErr(w, 502, "MAIL_BACKEND_ERROR", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "sent_saved": sentSaved, "warning": warning})
}

func readOutgoingAttachments(r *http.Request) ([]outgoingAttachment, error) {
	if r.MultipartForm == nil || r.MultipartForm.File == nil {
		return nil, nil
	}
	files := r.MultipartForm.File["attachments"]
	attachments := make([]outgoingAttachment, 0, len(files))
	var total int64

	for _, fh := range files {
		if fh == nil || strings.TrimSpace(fh.Filename) == "" {
			continue
		}
		if fh.Size < 0 {
			return nil, fmt.Errorf("invalid attachment size")
		}
		total += fh.Size
		if total > maxOutgoingAttachmentBytes {
			return nil, fmt.Errorf("附件总大小不能超过 50MB")
		}

		file, err := fh.Open()
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(file, fh.Size+1))
		_ = file.Close()
		if readErr != nil {
			return nil, readErr
		}
		if int64(len(data)) != fh.Size {
			return nil, fmt.Errorf("attachment read failed")
		}
		contentType := strings.TrimSpace(fh.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		attachments = append(attachments, outgoingAttachment{
			Filename:    sanitizeAttachmentFilename(fh.Filename),
			ContentType: contentType,
			Data:        data,
		})
	}
	return attachments, nil
}

func sanitizeAttachmentFilename(value string) string {
	name := strings.TrimSpace(value)
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\x00", "_")
	if name == "" {
		return "attachment"
	}
	return name
}

func (s *Server) portalSendMailWithAttachments(ctx context.Context, mailboxEmail, password, to, cc, bcc, subject, body string, attachments []outgoingAttachment) (bool, string, error) {
	toList, err := parseRecipientList(to)
	if err != nil {
		return false, "", err
	}
	ccList, err := parseRecipientList(cc)
	if err != nil {
		return false, "", err
	}
	bccList, err := parseRecipientList(bcc)
	if err != nil {
		return false, "", err
	}
	rawMessage, err := buildOutgoingMessageWithAttachments(mailboxEmail, toList, ccList, bccList, subject, body, true, attachments)
	if err != nil {
		return false, "", err
	}
	rcpts := append(append([]string{}, toList...), ccList...)
	rcpts = append(rcpts, bccList...)
	if err := s.smtpSendRaw(ctx, mailboxEmail, password, rcpts, rawMessage); err != nil {
		return false, "", err
	}
	if err := s.appendToFolder(ctx, mailboxEmail, password, "Sent", []string{`\Seen`}, rawMessage); err != nil {
		return false, "Message sent, but failed to save to Sent", nil
	}
	return true, "", nil
}

func buildOutgoingMessageWithAttachments(from string, to []string, cc []string, bcc []string, subject string, body string, requireRecipients bool, attachments []outgoingAttachment) ([]byte, error) {
	if len(attachments) == 0 {
		return buildOutgoingMessage(from, to, cc, bcc, subject, body, requireRecipients)
	}
	if !emailRe.MatchString(strings.TrimSpace(from)) {
		return nil, fmt.Errorf("invalid from address")
	}
	if requireRecipients && len(to) == 0 && len(cc) == 0 && len(bcc) == 0 {
		return nil, fmt.Errorf("recipient is required")
	}

	dateHeader := time.Now().UTC().Format(time.RFC1123Z)
	msgID := fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), strings.ReplaceAll(randomStringToken(8), ".", ""), strings.SplitN(from, "@", 2)[1])
	boundary := "mixed_" + randomStringToken(24)

	var msg bytes.Buffer
	msg.WriteString("From: " + from + "\r\n")
	if len(to) > 0 {
		msg.WriteString("To: " + strings.Join(to, ", ") + "\r\n")
	}
	if len(cc) > 0 {
		msg.WriteString("Cc: " + strings.Join(cc, ", ") + "\r\n")
	}
	encodedSubject := mime.QEncoding.Encode("utf-8", sanitizeMailHeader(subject))
	msg.WriteString("Subject: " + encodedSubject + "\r\n")
	msg.WriteString("Date: " + dateHeader + "\r\n")
	msg.WriteString("Message-ID: " + msgID + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n")
	msg.WriteString("\r\n")

	msg.WriteString("--" + boundary + "\r\n")
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	msg.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(body)
	if !strings.HasSuffix(body, "\n") {
		msg.WriteString("\r\n")
	}

	for _, attachment := range attachments {
		contentType := strings.TrimSpace(attachment.ContentType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		filename := sanitizeAttachmentFilename(attachment.Filename)
		encodedName := mime.QEncoding.Encode("utf-8", filename)

		msg.WriteString("\r\n--" + boundary + "\r\n")
		msg.WriteString("Content-Type: " + contentType + "; name=\"" + encodedName + "\"\r\n")
		msg.WriteString("Content-Disposition: attachment; filename=\"" + encodedName + "\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: base64\r\n")
		msg.WriteString("\r\n")
		writeBase64MIMELines(&msg, attachment.Data)
	}

	msg.WriteString("\r\n--" + boundary + "--\r\n")
	return msg.Bytes(), nil
}

func writeBase64MIMELines(buf *bytes.Buffer, data []byte) {
	encoded := base64.StdEncoding.EncodeToString(data)
	for len(encoded) > 76 {
		buf.WriteString(encoded[:76])
		buf.WriteString("\r\n")
		encoded = encoded[76:]
	}
	if encoded != "" {
		buf.WriteString(encoded)
		buf.WriteString("\r\n")
	}
}
