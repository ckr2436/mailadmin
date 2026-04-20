package main

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestParseMIMEEmailTextPlain(t *testing.T) {
	raw := []byte("From: a@example.com\r\nTo: b@example.com\r\nSubject: Hello\r\nDate: Mon, 20 Apr 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello world")
	parsed, err := parseMIMEEmail(raw, 1024)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if parsed.Text != "hello world" {
		t.Fatalf("unexpected text: %q", parsed.Text)
	}
	if parsed.HTML != "" {
		t.Fatalf("unexpected html: %q", parsed.HTML)
	}
}

func TestParseMIMEEmailTextHTML(t *testing.T) {
	raw := []byte("Content-Type: text/html; charset=utf-8\r\n\r\n<html><body><script>alert(1)</script><p>safe</p></body></html>")
	parsed, err := parseMIMEEmail(raw, 1024)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if strings.Contains(parsed.HTML, "script") {
		t.Fatalf("html should be sanitized: %q", parsed.HTML)
	}
	if !strings.Contains(parsed.HTML, "safe") {
		t.Fatalf("missing sanitized content: %q", parsed.HTML)
	}
}

func TestParseMIMEEmailMultipartAlternative(t *testing.T) {
	raw := []byte("Content-Type: multipart/alternative; boundary=abc\r\n\r\n--abc\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nplain part\r\n--abc\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<b>html part</b>\r\n--abc--\r\n")
	parsed, err := parseMIMEEmail(raw, 1024)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if !strings.Contains(parsed.Text, "plain part") {
		t.Fatalf("missing plain part: %q", parsed.Text)
	}
	if !strings.Contains(parsed.HTML, "html part") {
		t.Fatalf("missing html part: %q", parsed.HTML)
	}
}

func TestParseMIMEEmailMultipartMixedWithAttachment(t *testing.T) {
	raw := []byte("Content-Type: multipart/mixed; boundary=xyz\r\n\r\n--xyz\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nbody\r\n--xyz\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=report.pdf\r\n\r\nPDFDATA\r\n--xyz--\r\n")
	parsed, err := parseMIMEEmail(raw, 2048)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(parsed.Attachments) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(parsed.Attachments))
	}
	if parsed.Attachments[0].Filename != "report.pdf" {
		t.Fatalf("unexpected filename: %q", parsed.Attachments[0].Filename)
	}
}

func TestParseMIMEEmailBase64(t *testing.T) {
	raw := []byte("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8gYmFzZTY0")
	parsed, err := parseMIMEEmail(raw, 1024)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if strings.TrimSpace(parsed.Text) != "hello base64" {
		t.Fatalf("unexpected text: %q", parsed.Text)
	}
}

func TestParseMIMEEmailQuotedPrintable(t *testing.T) {
	raw := []byte("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nhello=20qp")
	parsed, err := parseMIMEEmail(raw, 1024)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if strings.TrimSpace(parsed.Text) != "hello qp" {
		t.Fatalf("unexpected text: %q", parsed.Text)
	}
}

func TestParseMIMEEmailNonUTF8Charset(t *testing.T) {
	raw := []byte("Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=E9")
	parsed, err := parseMIMEEmail(raw, 1024)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if strings.TrimSpace(parsed.Text) != "café" {
		t.Fatalf("unexpected text: %q", parsed.Text)
	}
}

func TestParseMIMEEmailMalformedMIME(t *testing.T) {
	raw := []byte("Content-Type: multipart/mixed\r\n\r\n--abc\r\nContent-Type:text/plain\r\n\r\nbody")
	_, err := parseMIMEEmail(raw, 1024)
	if err == nil {
		t.Fatalf("expected parse error for malformed MIME")
	}
}

func TestRunLimitedLargeMessageGuard(t *testing.T) {
	literalSize := 15*1024*1024 + 1
	resp := fmt.Sprintf("* 1 FETCH (UID 7 RFC822.SIZE %d BODY[] {%d}\r\n%s)\r\nA0001 OK done\r\n", literalSize, literalSize, strings.Repeat("a", literalSize))
	c := &imapConn{
		rd: bufio.NewReader(strings.NewReader(resp)),
		wr: bufio.NewWriter(io.Discard),
	}
	_, err := c.runLimited("UID FETCH 7 (UID RFC822.SIZE BODY.PEEK[])", 15*1024*1024)
	if err == nil || err != errLiteralTooLarge {
		t.Fatalf("expected errLiteralTooLarge, got: %v", err)
	}
	line, readErr := c.rd.ReadString('\n')
	if readErr != nil {
		t.Fatalf("expected remaining response after oversized literal drain: %v", readErr)
	}
	if line != ")\r\n" {
		t.Fatalf("unexpected post-drain line: %q", line)
	}
}

func TestParseMIMEEmailTextLimit(t *testing.T) {
	raw := []byte("Content-Type: text/plain; charset=utf-8\r\n\r\n1234567890")
	_, err := parseMIMEEmail(raw, 5)
	if err == nil || err != errTextBodyTooLarge {
		t.Fatalf("expected errTextBodyTooLarge, got: %v", err)
	}
}

func TestRunLimitedReadsLiteralWithinLimit(t *testing.T) {
	literal := "hello"
	resp := "* 1 FETCH (UID 7 BODY[] {5}\r\n" + literal + ")\r\nA0001 OK done\r\n"
	out := &bytes.Buffer{}
	c := &imapConn{
		rd: bufio.NewReader(strings.NewReader(resp)),
		wr: bufio.NewWriter(out),
	}
	raw, err := c.runLimited("UID FETCH 7 (UID BODY.PEEK[])", 10)
	if err != nil {
		t.Fatalf("runLimited failed: %v", err)
	}
	if !strings.Contains(raw, literal) {
		t.Fatalf("expected literal content in output: %q", raw)
	}
}
