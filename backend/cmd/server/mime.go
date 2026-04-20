package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"
	"time"

	"github.com/microcosm-cc/bluemonday"
	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

var errTextBodyTooLarge = errors.New("message text body too large")

type ParsedAttachment struct {
	Filename    string `json:"filename,omitempty"`
	ContentType string `json:"content_type,omitempty"`
	Size        int64  `json:"size"`
	Inline      bool   `json:"inline"`
	ContentID   string `json:"content_id,omitempty"`
}

type ParsedEmail struct {
	UID         string             `json:"uid,omitempty"`
	From        string             `json:"from,omitempty"`
	To          string             `json:"to,omitempty"`
	Subject     string             `json:"subject,omitempty"`
	Date        string             `json:"date,omitempty"`
	Size        int64              `json:"size,omitempty"`
	Text        string             `json:"text,omitempty"`
	HTML        string             `json:"html,omitempty"`
	Attachments []ParsedAttachment `json:"attachments,omitempty"`
}

type mimeParseState struct {
	textBuilder  strings.Builder
	htmlBuilder  strings.Builder
	textBytes    int64
	maxTextBytes int64
	attachments  []ParsedAttachment
}

func parseMIMEEmail(raw []byte, maxTextBytes int64) (ParsedEmail, error) {
	if len(raw) == 0 {
		return ParsedEmail{}, fmt.Errorf("empty message")
	}
	if maxTextBytes <= 0 {
		maxTextBytes = 2 << 20
	}
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return ParsedEmail{}, err
	}
	parsed := ParsedEmail{
		From:    decodeHeaderWord(msg.Header.Get("From")),
		To:      decodeHeaderWord(msg.Header.Get("To")),
		Subject: decodeHeaderWord(msg.Header.Get("Subject")),
		Date:    normalizeHeaderDate(msg.Header.Get("Date")),
	}
	state := &mimeParseState{maxTextBytes: maxTextBytes}
	if err := parseMIMEPart(textproto.MIMEHeader(msg.Header), msg.Body, state); err != nil {
		return ParsedEmail{}, err
	}
	policy := bluemonday.UGCPolicy()
	parsed.Text = strings.TrimSpace(state.textBuilder.String())
	parsed.HTML = strings.TrimSpace(policy.Sanitize(state.htmlBuilder.String()))
	parsed.Attachments = state.attachments
	return parsed, nil
}

func parseMIMEPart(h textproto.MIMEHeader, body io.Reader, state *mimeParseState) error {
	decodedBody, err := decodeTransferEncoding(h.Get("Content-Transfer-Encoding"), body)
	if err != nil {
		return err
	}
	contentType := strings.TrimSpace(h.Get("Content-Type"))
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		mediaType = "text/plain"
		params = map[string]string{}
	}
	if strings.HasPrefix(strings.ToLower(mediaType), "multipart/") {
		boundary := params["boundary"]
		if strings.TrimSpace(boundary) == "" {
			return fmt.Errorf("multipart without boundary")
		}
		mr := multipart.NewReader(decodedBody, boundary)
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}
			if err := parseMIMEPart(part.Header, part, state); err != nil {
				_ = part.Close()
				return err
			}
			_ = part.Close()
		}
		return nil
	}

	disposition, dispParams, _ := mime.ParseMediaType(h.Get("Content-Disposition"))
	filename := strings.TrimSpace(dispParams["filename"])
	if filename == "" {
		filename = strings.TrimSpace(params["name"])
	}
	isInline := strings.EqualFold(disposition, "inline")
	isAttachment := strings.EqualFold(disposition, "attachment") || filename != ""

	if !isAttachment && (strings.EqualFold(mediaType, "text/plain") || strings.EqualFold(mediaType, "text/html")) {
		charsetLabel := params["charset"]
		utfReader, _ := toUTF8Reader(decodedBody, charsetLabel)
		content, err := readLimitedText(utfReader, state)
		if err != nil {
			return err
		}
		if strings.EqualFold(mediaType, "text/plain") {
			if state.textBuilder.Len() > 0 && strings.TrimSpace(content) != "" {
				state.textBuilder.WriteString("\n\n")
			}
			state.textBuilder.WriteString(content)
		} else {
			if state.htmlBuilder.Len() > 0 && strings.TrimSpace(content) != "" {
				state.htmlBuilder.WriteString("\n")
			}
			state.htmlBuilder.WriteString(content)
		}
		return nil
	}

	size, _ := io.Copy(io.Discard, decodedBody)
	state.attachments = append(state.attachments, ParsedAttachment{
		Filename:    decodeHeaderWord(filename),
		ContentType: mediaType,
		Size:        size,
		Inline:      isInline,
		ContentID:   strings.Trim(strings.TrimSpace(h.Get("Content-ID")), "<>"),
	})
	return nil
}

func decodeTransferEncoding(enc string, body io.Reader) (io.Reader, error) {
	switch strings.ToLower(strings.TrimSpace(enc)) {
	case "", "7bit", "8bit", "binary":
		return body, nil
	case "base64":
		return base64.NewDecoder(base64.StdEncoding, body), nil
	case "quoted-printable":
		return quotedprintable.NewReader(body), nil
	default:
		return body, nil
	}
}

func toUTF8Reader(r io.Reader, cs string) (io.Reader, error) {
	if strings.TrimSpace(cs) == "" {
		return r, nil
	}
	converted, err := charset.NewReaderLabel(cs, r)
	if err != nil {
		return r, nil
	}
	return converted, nil
}

func readLimitedText(r io.Reader, state *mimeParseState) (string, error) {
	remaining := state.maxTextBytes - state.textBytes
	if remaining <= 0 {
		return "", errTextBodyTooLarge
	}
	lr := io.LimitReader(r, remaining+1)
	buf, err := io.ReadAll(lr)
	if err != nil {
		return "", err
	}
	if int64(len(buf)) > remaining {
		state.textBytes = state.maxTextBytes
		return "", errTextBodyTooLarge
	}
	state.textBytes += int64(len(buf))
	return string(buf), nil
}

func decodeHeaderWord(v string) string {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return ""
	}
	decoder := &mime.WordDecoder{CharsetReader: func(charsetName string, input io.Reader) (io.Reader, error) {
		return charset.NewReaderLabel(charsetName, input)
	}}
	decoded, err := decoder.DecodeHeader(trimmed)
	if err != nil {
		return trimmed
	}
	return decoded
}

func normalizeHeaderDate(v string) string {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return ""
	}
	if t, err := mail.ParseDate(trimmed); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	return trimmed
}

func buildMIMEPreview(raw []byte, maxBytes int64, maxChars int) string {
	if len(raw) == 0 {
		return ""
	}
	if maxBytes <= 0 {
		maxBytes = 64 * 1024
	}
	if maxChars <= 0 {
		maxChars = 180
	}
	if int64(len(raw)) > maxBytes {
		raw = raw[:maxBytes]
	}
	parsed, err := parseMIMEEmail(raw, maxBytes)
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(parsed.Text)
	if text == "" {
		text = htmlToPlainText(parsed.HTML)
	}
	return cleanPreviewText(text, maxChars)
}

func htmlToPlainText(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	node, err := html.Parse(strings.NewReader(v))
	if err != nil {
		return strings.TrimSpace(v)
	}
	parts := make([]string, 0, 16)
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			trimmed := strings.TrimSpace(n.Data)
			if trimmed != "" {
				parts = append(parts, trimmed)
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(node)
	return strings.Join(parts, " ")
}

func cleanPreviewText(v string, maxChars int) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(v, "\r", "\n"), "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "content-type:") ||
			strings.HasPrefix(lower, "content-transfer-encoding:") ||
			strings.HasPrefix(lower, "content-disposition:") ||
			strings.HasPrefix(lower, "content-id:") ||
			strings.HasPrefix(lower, "mime-version:") ||
			strings.HasPrefix(lower, "boundary=") ||
			strings.HasPrefix(trimmed, "--") {
			continue
		}
		cleaned = append(cleaned, trimmed)
	}
	joined := strings.Join(cleaned, " ")
	joined = strings.Join(strings.Fields(joined), " ")
	if joined == "" {
		return ""
	}
	if maxChars <= 0 {
		maxChars = 180
	}
	runes := []rune(joined)
	if len(runes) <= maxChars {
		return joined
	}
	return strings.TrimSpace(string(runes[:maxChars])) + "…"
}
