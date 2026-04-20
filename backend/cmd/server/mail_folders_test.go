package main

import (
	"bufio"
	"strings"
	"testing"
	"time"
)

func TestParseIMAPFoldersSpecialUse(t *testing.T) {
	raw := "* LIST (\\HasNoChildren \\Sent) \"/\" Sent\r\n* LIST (\\HasNoChildren \\Drafts) \"/\" Drafts\r\n"
	items := parseIMAPFolders(raw)
	if len(items) != 2 {
		t.Fatalf("expected 2 folders, got %d", len(items))
	}
	if items[0].Role != "sent" || items[0].SpecialUse != `\Sent` {
		t.Fatalf("unexpected sent mapping: %+v", items[0])
	}
	if items[1].Role != "drafts" || items[1].SpecialUse != `\Drafts` {
		t.Fatalf("unexpected drafts mapping: %+v", items[1])
	}
}

func TestMergeDefaultFoldersFallback(t *testing.T) {
	items := mergeDefaultFolders(nil)
	if len(items) < 6 {
		t.Fatalf("expected default folders, got %d", len(items))
	}
	if items[0].Path != "INBOX" {
		t.Fatalf("expected inbox first, got %s", items[0].Path)
	}
}

func TestBuildOutgoingMessage(t *testing.T) {
	raw, err := buildOutgoingMessage("support@example.com", []string{"a@example.com"}, []string{"b@example.com"}, nil, "Hello", "Body")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	text := string(raw)
	for _, header := range []string{"From:", "To:", "Cc:", "Subject:", "Date:", "Message-ID:", "MIME-Version:", "Content-Type:"} {
		if !strings.Contains(text, header) {
			t.Fatalf("missing header %s", header)
		}
	}
}

func TestAppendMessageLiteralFlow(t *testing.T) {
	server := "+ Ready for literal data\r\nA0001 OK Append completed\r\n"
	buf := &strings.Builder{}
	c := &imapConn{
		rd: bufio.NewReader(strings.NewReader(server)),
		wr: bufio.NewWriter(buf),
	}
	if err := c.appendMessage("Sent", []string{`\\Seen`}, time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC), []byte("raw body")); err != nil {
		t.Fatalf("appendMessage failed: %v", err)
	}
	written := buf.String()
	if !strings.Contains(written, "APPEND \"Sent\"") || !strings.Contains(written, "{8}\r\nraw body\r\n") {
		t.Fatalf("unexpected append wire data: %q", written)
	}
}

func TestNormalizeIMAPFolderAllowedOnly(t *testing.T) {
	if _, err := normalizeIMAPFolder("Projects"); err == nil {
		t.Fatalf("expected custom folder to be rejected")
	}
	if got, err := normalizeIMAPFolder("INBOX"); err != nil || got != "INBOX" {
		t.Fatalf("expected INBOX normalized, got %q err=%v", got, err)
	}
}
