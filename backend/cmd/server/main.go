package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Config struct {
	AppAddr                    string
	AppTrustProxy              bool
	SessionSecret              string
	CookieSecure               bool
	CookieSameSite             string
	CookieDomain               string
	AdminCookieName            string
	PortalCookieName           string
	SessionTTLSeconds          int64
	DBSocket                   string
	DBName                     string
	DBROUser                   string
	DBROPass                   string
	DBAdminUser                string
	DBAdminPass                string
	DefaultDomain              string
	MailHost                   string
	DovecotBin                 string
	PostfixCfg                 string
	MySQLBin                   string
	OpenSSLBin                 string
	AdminTable                 string
	AuditTable                 string
	AdminWorkspaceBindingTable string
	RedisNetwork               string
	RedisAddr                  string
	RedisPassword              string
	RedisDB                    int
	WebmailAccountEncKey       string
	WebmailAccountTTLSeconds   int64
	WebmailMaxAccounts         int
	WebmailInboxLimitDefault   int
	WebmailInboxLimitMax       int
	WebmailIMAPTimeoutSeconds  int64
	WebmailAllInboxConcurrency int
}

type Session struct {
	Subject   string `json:"sub"`
	Kind      string `json:"kind"`
	Workspace string `json:"ws,omitempty"`
	SessionID string `json:"sid,omitempty"`
	Version   int64  `json:"ver,omitempty"`
	Role      string `json:"role,omitempty"`
	Exp       int64  `json:"exp"`
}

type DomainRow struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Active *bool  `json:"active,omitempty"`
}
type MailboxRow struct {
	ID     int64  `json:"id"`
	Email  string `json:"email"`
	Active *bool  `json:"active,omitempty"`
}
type AliasRow struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Active      *bool  `json:"active,omitempty"`
}
type WorkspaceRow struct {
	ID            int64    `json:"id"`
	Slug          string   `json:"slug"`
	Name          string   `json:"name"`
	DefaultDomain string   `json:"default_domain,omitempty"`
	Active        bool     `json:"active"`
	Domains       []string `json:"domains,omitempty"`
}
type BindingPermission struct {
	WorkspaceSlug   string `json:"workspace_slug"`
	WorkspaceName   string `json:"workspace_name,omitempty"`
	CanRead         bool   `json:"can_read"`
	CanWrite        bool   `json:"can_write"`
	ManageDomains   bool   `json:"manage_domains"`
	ManageMailboxes bool   `json:"manage_mailboxes"`
	ManageAliases   bool   `json:"manage_aliases"`
}

type WebmailMessage struct {
	Sequence int    `json:"sequence"`
	UID      string `json:"uid,omitempty"`
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
	Subject  string `json:"subject,omitempty"`
	Date     string `json:"date,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Preview  string `json:"preview,omitempty"`
}

func (p BindingPermission) allows(resource string, write bool) bool {
	if write {
		if !p.CanWrite {
			return false
		}
		switch resource {
		case "domain":
			return p.ManageDomains
		case "mailbox":
			return p.ManageMailboxes
		case "alias":
			return p.ManageAliases
		default:
			return p.CanWrite
		}
	}
	if !p.CanRead {
		return false
	}
	switch resource {
	case "domain":
		return p.ManageDomains || p.CanRead
	case "mailbox":
		return p.ManageMailboxes || p.CanRead
	case "alias":
		return p.ManageAliases || p.CanRead
	default:
		return p.CanRead
	}
}

type AdminUserRow struct {
	ID         int64               `json:"id"`
	Username   string              `json:"username"`
	Role       string              `json:"role"`
	Active     bool                `json:"active"`
	Workspaces []string            `json:"workspaces,omitempty"`
	Bindings   []BindingPermission `json:"bindings,omitempty"`
}

type Server struct {
	cfg           Config
	logger        *log.Logger
	mu            sync.Mutex
	loginAttempts map[string]loginAttempt
	webmailEncKey [32]byte
}

type loginAttempt struct {
	Failures    int
	LastFailure time.Time
	LockedUntil time.Time
}

type WebmailAccount struct {
	AccountID          string `json:"account_id"`
	Email              string `json:"email"`
	Workspace          string `json:"workspace"`
	Domain             string `json:"domain"`
	PasswordCiphertext string `json:"password_ciphertext"`
	PasswordHash       string `json:"password_hash"`
	ConnectedAt        int64  `json:"connected_at"`
	ExpiresAt          int64  `json:"expires_at"`
}

type InboxItem struct {
	MessageID    string `json:"message_id"`
	AccountID    string `json:"account_id"`
	AccountEmail string `json:"account_email"`
	Folder       string `json:"folder"`
	UID          string `json:"uid"`
	From         string `json:"from,omitempty"`
	To           string `json:"to,omitempty"`
	Subject      string `json:"subject,omitempty"`
	Date         string `json:"date,omitempty"`
	InternalDate string `json:"internal_date,omitempty"`
	Preview      string `json:"preview,omitempty"`
	Size         int64  `json:"size,omitempty"`
}

var (
	domainRe    = regexp.MustCompile(`^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`)
	localpartRe = regexp.MustCompile(`^[A-Za-z0-9._%+\-]+$`)
	emailRe     = regexp.MustCompile(`^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`)
	usernameRe  = regexp.MustCompile(`^[A-Za-z0-9._@\-]{3,64}$`)
)

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
func envBool(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}
func envInt64(key string, fallback int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}
func loadConfig() (Config, error) {
	cfg := Config{
		AppAddr:                    env("APP_ADDR", "127.0.0.1:18080"),
		AppTrustProxy:              envBool("APP_TRUST_PROXY", false),
		SessionSecret:              os.Getenv("SESSION_SECRET"),
		CookieSecure:               envBool("COOKIE_SECURE", true),
		CookieSameSite:             env("COOKIE_SAMESITE", "Lax"),
		CookieDomain:               env("COOKIE_DOMAIN", "mail.myupona.com"),
		AdminCookieName:            env("ADMIN_COOKIE_NAME", "mailadmin_session"),
		PortalCookieName:           env("PORTAL_COOKIE_NAME", "mailportal_session"),
		SessionTTLSeconds:          envInt64("SESSION_TTL_SECONDS", 28800),
		DBSocket:                   env("DB_SOCKET", "/var/lib/mysql/mysql.sock"),
		DBName:                     env("DB_NAME", "mailserver"),
		DBROUser:                   env("DB_RO_USER", "mailro"),
		DBROPass:                   os.Getenv("DB_RO_PASS"),
		DBAdminUser:                env("DB_ADMIN_USER", "mailadmin"),
		DBAdminPass:                os.Getenv("DB_ADMIN_PASS"),
		DefaultDomain:              env("DEFAULT_DOMAIN", "myupona.com"),
		MailHost:                   env("MAIL_HOST", "mail.myupona.com"),
		DovecotBin:                 env("DOVECOT_BIN", "/opt/apps/dovecot/bin"),
		PostfixCfg:                 env("POSTFIX_CFG", "/opt/apps/postfix/etc/postfix"),
		MySQLBin:                   env("MYSQL_BIN", "/usr/bin/mysql"),
		OpenSSLBin:                 env("OPENSSL_BIN", "/usr/bin/openssl"),
		AdminTable:                 env("ADMIN_TABLE", "app_admin_users"),
		AuditTable:                 env("AUDIT_TABLE", "app_audit_logs"),
		AdminWorkspaceBindingTable: env("ADMIN_WORKSPACE_BINDING_TABLE", "app_admin_workspace_bindings"),
		RedisNetwork:               env("REDIS_NETWORK", "tcp"),
		RedisAddr:                  env("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:              os.Getenv("REDIS_PASSWORD"),
		RedisDB:                    int(envInt64("REDIS_DB", 0)),
		WebmailAccountEncKey:       os.Getenv("WEBMAIL_ACCOUNT_ENC_KEY"),
		WebmailAccountTTLSeconds:   envInt64("WEBMAIL_ACCOUNT_TTL_SECONDS", 28800),
		WebmailMaxAccounts:         int(envInt64("WEBMAIL_MAX_ACCOUNTS_PER_SESSION", 10)),
		WebmailInboxLimitDefault:   int(envInt64("WEBMAIL_INBOX_LIMIT_DEFAULT", 50)),
		WebmailInboxLimitMax:       int(envInt64("WEBMAIL_INBOX_LIMIT_MAX", 100)),
		WebmailIMAPTimeoutSeconds:  envInt64("WEBMAIL_IMAP_TIMEOUT_SECONDS", 10),
		WebmailAllInboxConcurrency: int(envInt64("WEBMAIL_ALL_INBOX_CONCURRENCY", 5)),
	}
	if cfg.SessionSecret == "" {
		return cfg, fmt.Errorf("SESSION_SECRET is required")
	}
	if strings.TrimSpace(cfg.WebmailAccountEncKey) == "" {
		return cfg, fmt.Errorf("WEBMAIL_ACCOUNT_ENC_KEY is required")
	}
	cfg.RedisNetwork = strings.ToLower(strings.TrimSpace(cfg.RedisNetwork))
	if cfg.RedisNetwork != "tcp" && cfg.RedisNetwork != "unix" {
		return cfg, fmt.Errorf("REDIS_NETWORK must be tcp or unix")
	}
	if strings.TrimSpace(cfg.RedisAddr) == "" {
		return cfg, fmt.Errorf("REDIS_ADDR is required")
	}
	if cfg.RedisNetwork == "unix" && !strings.HasPrefix(strings.TrimSpace(cfg.RedisAddr), "/") {
		return cfg, fmt.Errorf("REDIS_ADDR must be an absolute socket path when REDIS_NETWORK=unix")
	}
	return cfg, nil
}

func (s *Server) sqlQuote(v string) string {
	v = strings.ReplaceAll(v, `\`, `\\`)
	v = strings.ReplaceAll(v, `'`, `\'`)
	return "'" + v + "'"
}
func splitLines(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	sc := bufio.NewScanner(strings.NewReader(raw))
	var out []string
	for sc.Scan() {
		t := strings.TrimSpace(sc.Text())
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}
func boolPtr(raw string) *bool {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	v := strings.TrimSpace(raw) == "1"
	return &v
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func randomTokenHex(n int) (string, error) {
	if n <= 0 {
		n = 32
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func readJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.AppTrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return strings.TrimSpace(xr)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
func (s *Server) execSQL(ctx context.Context, role, sql string) (string, error) {
	user, pass := s.cfg.DBROUser, s.cfg.DBROPass
	if role == "admin" {
		user, pass = s.cfg.DBAdminUser, s.cfg.DBAdminPass
	}
	if user == "" || pass == "" {
		return "", fmt.Errorf("missing mysql credentials for %s", role)
	}
	cmd := exec.CommandContext(ctx, s.cfg.MySQLBin, "--protocol=socket", "-S", s.cfg.DBSocket, "-N", "-s", "-u", user, s.cfg.DBName, "-e", sql)
	cmd.Env = append(os.Environ(), "MYSQL_PWD="+pass)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("mysql exec failed: %w: %s", err, strings.TrimSpace(errb.String()))
	}
	return strings.TrimSpace(out.String()), nil
}
func (s *Server) columnExists(ctx context.Context, table, col string) (bool, error) {
	q := fmt.Sprintf("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s;", s.sqlQuote(s.cfg.DBName), s.sqlQuote(table), s.sqlQuote(col))
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return false, err
	}
	n, _ := strconv.Atoi(strings.TrimSpace(out))
	return n > 0, nil
}
func (s *Server) ensureColumn(ctx context.Context, table, col, ddl string) error {
	exists, err := s.columnExists(ctx, table, col)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s;", table, col, ddl))
	return err
}

func (s *Server) hashPassword(ctx context.Context, plain string) (string, error) {
	doveadm := filepath.Join(s.cfg.DovecotBin, "doveadm")
	if _, err := os.Stat(doveadm); err == nil {
		out, err := exec.CommandContext(ctx, doveadm, "pw", "-s", "SHA512-CRYPT", "-p", plain).CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("doveadm hash failed: %s", strings.TrimSpace(string(out)))
		}
		return strings.TrimSpace(string(out)), nil
	}
	out, err := exec.CommandContext(ctx, s.cfg.OpenSSLBin, "passwd", "-6", plain).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("openssl hash failed: %s", strings.TrimSpace(string(out)))
	}
	return "{SHA512-CRYPT}" + strings.TrimSpace(string(out)), nil
}
func (s *Server) verifyHash(ctx context.Context, hash, plain string) error {
	doveadm := filepath.Join(s.cfg.DovecotBin, "doveadm")
	out, err := exec.CommandContext(ctx, doveadm, "pw", "-t", hash, "-p", plain).CombinedOutput()
	if err != nil {
		return fmt.Errorf("password verify failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func (s *Server) ensureMetaTables(ctx context.Context) error {
	q := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'superadmin',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  session_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS %s (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(32) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target VARCHAR(255) NULL,
  detail_json TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS app_workspaces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  default_domain VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS app_workspace_domains (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  domain_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_domain (domain_name),
  KEY idx_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS %s (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  can_read TINYINT(1) NOT NULL DEFAULT 1,
  can_write TINYINT(1) NOT NULL DEFAULT 1,
  manage_domains TINYINT(1) NOT NULL DEFAULT 1,
  manage_mailboxes TINYINT(1) NOT NULL DEFAULT 1,
  manage_aliases TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_admin_workspace (admin_user_id, workspace_id),
  KEY idx_workspace_id (workspace_id),
  KEY idx_admin_user_id (admin_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO app_workspaces(slug,name,default_domain,is_active) VALUES('default','Default Workspace',%s,1)
ON DUPLICATE KEY UPDATE default_domain=VALUES(default_domain), is_active=1;
INSERT INTO app_workspace_domains(workspace_id,domain_name)
SELECT id,%s FROM app_workspaces WHERE slug='default'
ON DUPLICATE KEY UPDATE workspace_id=VALUES(workspace_id);`, s.cfg.AdminTable, s.cfg.AuditTable, s.cfg.AdminWorkspaceBindingTable, s.sqlQuote(s.cfg.DefaultDomain), s.sqlQuote(s.cfg.DefaultDomain))
	if _, err := s.execSQL(ctx, "admin", q); err != nil {
		return err
	}
	for _, col := range []string{"manage_domains", "manage_mailboxes", "manage_aliases"} {
		if err := s.ensureColumn(ctx, s.cfg.AdminWorkspaceBindingTable, col, "TINYINT(1) NOT NULL DEFAULT 1"); err != nil {
			return err
		}
	}
	if err := s.ensureColumn(ctx, s.cfg.AdminTable, "session_version", "BIGINT NOT NULL DEFAULT 1"); err != nil {
		return err
	}
	return nil
}
func (s *Server) audit(ctx context.Context, actorType, actor, action, target, detail string) {
	if actor == "" || action == "" {
		return
	}
	q := fmt.Sprintf("INSERT INTO %s(actor_type,actor,action,target,detail_json) VALUES(%s,%s,%s,%s,%s);", s.cfg.AuditTable, s.sqlQuote(actorType), s.sqlQuote(actor), s.sqlQuote(action), s.sqlQuote(target), s.sqlQuote(detail))
	_, _ = s.execSQL(ctx, "admin", q)
}

// sessions
func (s *Server) sign(sess Session) (string, error) {
	payload, err := json.Marshal(sess)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, []byte(s.cfg.SessionSecret))
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func (s *Server) parseSession(raw string) (*Session, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid session")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(s.cfg.SessionSecret))
	_, _ = mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, fmt.Errorf("invalid signature")
	}
	var sess Session
	if err := json.Unmarshal(payload, &sess); err != nil {
		return nil, err
	}
	if sess.Exp < time.Now().Unix() {
		return nil, errors.New("expired session")
	}
	return &sess, nil
}
func (s *Server) sameSite() http.SameSite {
	switch strings.ToLower(s.cfg.CookieSameSite) {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}
func (s *Server) setCookie(w http.ResponseWriter, name string, sess Session) error {
	raw, err := s.sign(sess)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: raw, Path: "/", Domain: s.cfg.CookieDomain, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: s.sameSite(), MaxAge: int(s.cfg.SessionTTLSeconds), Expires: time.Unix(sess.Exp, 0)})
	return nil
}
func (s *Server) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", Domain: s.cfg.CookieDomain, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: s.sameSite(), MaxAge: -1, Expires: time.Unix(0, 0)})
}
func (s *Server) csrfCookieName(kind string) string {
	return "mailadmin_csrf_" + kind
}
func (s *Server) setCSRFCookie(w http.ResponseWriter, kind string) (string, error) {
	token, err := randomTokenHex(24)
	if err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{Name: s.csrfCookieName(kind), Value: token, Path: "/", Domain: s.cfg.CookieDomain, HttpOnly: false, Secure: s.cfg.CookieSecure, SameSite: s.sameSite(), MaxAge: int(s.cfg.SessionTTLSeconds)})
	return token, nil
}
func (s *Server) clearCSRFCookie(w http.ResponseWriter, kind string) {
	http.SetCookie(w, &http.Cookie{Name: s.csrfCookieName(kind), Value: "", Path: "/", Domain: s.cfg.CookieDomain, HttpOnly: false, Secure: s.cfg.CookieSecure, SameSite: s.sameSite(), MaxAge: -1, Expires: time.Unix(0, 0)})
}
func requiresCSRF(r *http.Request) bool {
	return !(r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions)
}
func sameHost(origin, host string) bool {
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, host)
}
func (s *Server) validateOriginAndCSRF(w http.ResponseWriter, r *http.Request, kind string) bool {
	if !requiresCSRF(r) {
		return true
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" || !sameHost(origin, r.Host) {
		writeErr(w, 403, "CSRF_INVALID_ORIGIN", "Invalid request origin")
		return false
	}
	c, err := r.Cookie(s.csrfCookieName(kind))
	if err != nil || strings.TrimSpace(c.Value) == "" {
		writeErr(w, 403, "CSRF_MISSING", "Missing CSRF cookie")
		return false
	}
	headerToken := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	if headerToken == "" || !hmac.Equal([]byte(headerToken), []byte(c.Value)) {
		writeErr(w, 403, "CSRF_INVALID", "Invalid CSRF token")
		return false
	}
	return true
}
func (s *Server) checkLoginRateLimit(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	at := s.loginAttempts[key]
	if !at.LockedUntil.IsZero() && at.LockedUntil.After(now) {
		sec := int(at.LockedUntil.Sub(now).Seconds())
		if sec < 1 {
			sec = 1
		}
		return fmt.Errorf("too many failed attempts, retry in %d seconds", sec)
	}
	return nil
}
func (s *Server) registerLoginFailure(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	at := s.loginAttempts[key]
	if at.LastFailure.IsZero() || now.Sub(at.LastFailure) > 15*time.Minute {
		at.Failures = 0
	}
	at.Failures++
	at.LastFailure = now
	if at.Failures >= 5 {
		lockSeconds := min(300, (at.Failures-4)*30)
		at.LockedUntil = now.Add(time.Duration(lockSeconds) * time.Second)
	}
	s.loginAttempts[key] = at
}
func (s *Server) clearLoginFailure(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.loginAttempts, key)
}
func (s *Server) getSession(r *http.Request, name, kind string) (*Session, error) {
	c, err := r.Cookie(name)
	if err != nil {
		return nil, err
	}
	sess, err := s.parseSession(c.Value)
	if err != nil {
		return nil, err
	}
	if sess.Kind != kind {
		return nil, errors.New("wrong session kind")
	}
	return sess, nil
}
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) *Session {
	sess, err := s.getSession(r, s.cfg.AdminCookieName, "admin")
	if err != nil {
		writeErr(w, 401, "UNAUTHORIZED", "Admin login required")
		return nil
	}
	if !s.validateOriginAndCSRF(w, r, "admin") {
		return nil
	}
	enriched, err := s.adminAuthState(r.Context(), sess)
	if err != nil {
		writeErr(w, 401, "UNAUTHORIZED", "Session expired, please login again")
		return nil
	}
	return enriched
}
func (s *Server) requirePortal(w http.ResponseWriter, r *http.Request) *Session {
	sess, err := s.getSession(r, s.cfg.PortalCookieName, "portal")
	if err != nil {
		writeErr(w, 401, "UNAUTHORIZED", "Mailbox login required")
		return nil
	}
	if !s.validateOriginAndCSRF(w, r, "portal") {
		return nil
	}
	return sess
}

// core queries
func (s *Server) domainID(ctx context.Context, domain string) (int64, error) {
	out, err := s.execSQL(ctx, "ro", "SELECT id FROM virtual_domains WHERE name="+s.sqlQuote(domain)+" LIMIT 1;")
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(out) == "" {
		return 0, errors.New("domain not found")
	}
	return strconv.ParseInt(strings.TrimSpace(out), 10, 64)
}
func (s *Server) adminLookup(ctx context.Context, username string) (hash, role string, active bool, version int64, found bool, err error) {
	out, err := s.execSQL(ctx, "ro", fmt.Sprintf("SELECT password_hash,role,is_active,COALESCE(session_version,1) FROM %s WHERE username=%s LIMIT 1;", s.cfg.AdminTable, s.sqlQuote(username)))
	if err != nil {
		return
	}
	if strings.TrimSpace(out) == "" {
		return "", "", false, 0, false, nil
	}
	cols := strings.Split(out, "\t")
	if len(cols) < 4 {
		return "", "", false, 0, false, fmt.Errorf("unexpected admin row")
	}
	ver, _ := strconv.ParseInt(strings.TrimSpace(cols[3]), 10, 64)
	if ver <= 0 {
		ver = 1
	}
	return cols[0], cols[1], strings.TrimSpace(cols[2]) == "1", ver, true, nil
}
func (s *Server) adminIDByUsername(ctx context.Context, username string) (int64, error) {
	out, err := s.execSQL(ctx, "ro", fmt.Sprintf("SELECT id FROM %s WHERE username=%s LIMIT 1;", s.cfg.AdminTable, s.sqlQuote(username)))
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(out) == "" {
		return 0, fmt.Errorf("admin user not found")
	}
	return strconv.ParseInt(strings.TrimSpace(out), 10, 64)
}
func (s *Server) isSuperadmin(sess *Session) bool {
	return sess != nil && strings.EqualFold(sess.Role, "superadmin")
}
func (s *Server) adminAuthState(ctx context.Context, sess *Session) (*Session, error) {
	if sess == nil || strings.TrimSpace(sess.Subject) == "" {
		return nil, errors.New("missing admin session")
	}
	_, role, active, version, found, err := s.adminLookup(ctx, sess.Subject)
	if err != nil {
		return nil, err
	}
	if !found || !active {
		return nil, errors.New("admin disabled")
	}
	if sess.Version != version {
		return nil, errors.New("session invalidated")
	}
	enriched := *sess
	enriched.Role = role
	return &enriched, nil
}
func (s *Server) adminWorkspaceBindings(ctx context.Context, username string) ([]BindingPermission, error) {
	if username == "" {
		return nil, nil
	}
	q := fmt.Sprintf("SELECT w.slug,w.name,b.can_read,b.can_write,COALESCE(b.manage_domains,1),COALESCE(b.manage_mailboxes,1),COALESCE(b.manage_aliases,1) FROM %s b JOIN %s a ON a.id=b.admin_user_id JOIN app_workspaces w ON w.id=b.workspace_id WHERE a.username=%s AND a.is_active=1 ORDER BY w.slug;", s.cfg.AdminWorkspaceBindingTable, s.cfg.AdminTable, s.sqlQuote(username))
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	items := []BindingPermission{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 7 {
			continue
		}
		items = append(items, BindingPermission{WorkspaceSlug: cols[0], WorkspaceName: cols[1], CanRead: strings.TrimSpace(cols[2]) == "1", CanWrite: strings.TrimSpace(cols[3]) == "1", ManageDomains: strings.TrimSpace(cols[4]) == "1", ManageMailboxes: strings.TrimSpace(cols[5]) == "1", ManageAliases: strings.TrimSpace(cols[6]) == "1"})
	}
	return items, nil
}
func (s *Server) adminWorkspaceSlugs(ctx context.Context, username string) ([]string, error) {
	bindings, err := s.adminWorkspaceBindings(ctx, username)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, b := range bindings {
		if b.CanRead {
			out = append(out, b.WorkspaceSlug)
		}
	}
	return out, nil
}
func (s *Server) adminWorkspacePermission(ctx context.Context, username, slug string) (BindingPermission, bool, error) {
	bindings, err := s.adminWorkspaceBindings(ctx, username)
	if err != nil {
		return BindingPermission{}, false, err
	}
	for _, b := range bindings {
		if b.WorkspaceSlug == slug {
			return b, true, nil
		}
	}
	return BindingPermission{}, false, nil
}
func (s *Server) adminCanAccessWorkspace(ctx context.Context, sess *Session, slug string) (bool, error) {
	if s.isSuperadmin(sess) {
		return true, nil
	}
	if sess == nil || strings.TrimSpace(slug) == "" {
		return false, nil
	}
	perm, found, err := s.adminWorkspacePermission(ctx, sess.Subject, slug)
	if err != nil {
		return false, err
	}
	return found && perm.CanRead, nil
}
func (s *Server) allowedWorkspaceSlugs(ctx context.Context, sess *Session) ([]string, error) {
	if s.isSuperadmin(sess) {
		rows, err := s.listWorkspaceRows(ctx, false)
		if err != nil {
			return nil, err
		}
		items := []string{}
		for _, row := range rows {
			items = append(items, row.Slug)
		}
		return items, nil
	}
	return s.adminWorkspaceSlugs(ctx, sess.Subject)
}
func (s *Server) allowedDomainSet(ctx context.Context, sess *Session, requestedWorkspace string) (map[string]bool, error) {
	allowed := map[string]bool{}
	workspaces := []string{}
	if strings.TrimSpace(requestedWorkspace) != "" {
		ok, err := s.adminCanAccessWorkspace(ctx, sess, requestedWorkspace)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("forbidden workspace")
		}
		workspaces = []string{requestedWorkspace}
	} else {
		var err error
		workspaces, err = s.allowedWorkspaceSlugs(ctx, sess)
		if err != nil {
			return nil, err
		}
	}
	for _, slug := range workspaces {
		ds, err := s.listWorkspaceDomains(ctx, slug)
		if err != nil {
			return nil, err
		}
		for _, d := range ds {
			allowed[d] = true
		}
	}
	return allowed, nil
}
func domainFromEmail(email string) (string, error) {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid email")
	}
	return parts[1], nil
}
func (s *Server) workspacePermissionForDomain(ctx context.Context, sess *Session, domain string) (BindingPermission, error) {
	if s.isSuperadmin(sess) {
		return BindingPermission{WorkspaceSlug: "*", CanRead: true, CanWrite: true, ManageDomains: true, ManageMailboxes: true, ManageAliases: true}, nil
	}
	bindings, err := s.adminWorkspaceBindings(ctx, sess.Subject)
	if err != nil {
		return BindingPermission{}, err
	}
	for _, b := range bindings {
		ok, err := s.workspaceOwnsDomain(ctx, b.WorkspaceSlug, domain)
		if err != nil {
			return BindingPermission{}, err
		}
		if ok {
			return b, nil
		}
	}
	return BindingPermission{}, fmt.Errorf("domain is outside your workspace scope")
}
func (s *Server) requireResourcePermission(w http.ResponseWriter, r *http.Request, sess *Session, resource, domain string, write bool) bool {
	perm, err := s.workspacePermissionForDomain(r.Context(), sess, domain)
	if err != nil {
		writeErr(w, 403, "FORBIDDEN", err.Error())
		return false
	}
	if !perm.allows(resource, write) {
		writeErr(w, 403, "FORBIDDEN", "Permission denied for this workspace resource")
		return false
	}
	return true
}
func (s *Server) ensureWorkspaceAccess(w http.ResponseWriter, r *http.Request, sess *Session, slug string) bool {
	ok, err := s.adminCanAccessWorkspace(r.Context(), sess, slug)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return false
	}
	if !ok {
		writeErr(w, 403, "FORBIDDEN", "Not allowed to access this workspace")
		return false
	}
	return true
}
func (s *Server) ensureSuperadmin(w http.ResponseWriter, sess *Session) bool {
	if s.isSuperadmin(sess) {
		return true
	}
	writeErr(w, 403, "FORBIDDEN", "Superadmin required")
	return false
}
func (s *Server) mailboxLookup(ctx context.Context, email string) (hash string, active bool, found bool, err error) {
	hasActive, err := s.columnExists(ctx, "virtual_users", "active")
	if err != nil {
		return
	}
	q := "SELECT password"
	if hasActive {
		q += ",active"
	}
	q += " FROM virtual_users WHERE email=" + s.sqlQuote(email) + " LIMIT 1;"
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return
	}
	if strings.TrimSpace(out) == "" {
		return "", false, false, nil
	}
	cols := strings.Split(out, "\t")
	hash = cols[0]
	active = true
	if hasActive && len(cols) > 1 {
		active = strings.TrimSpace(cols[1]) == "1"
	}
	return hash, active, true, nil
}
func (s *Server) listDomains(ctx context.Context) ([]DomainRow, error) {
	hasActive, err := s.columnExists(ctx, "virtual_domains", "active")
	if err != nil {
		return nil, err
	}
	q := "SELECT id,name"
	if hasActive {
		q += ",active"
	}
	q += " FROM virtual_domains ORDER BY name;"
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	rows := []DomainRow{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 2 {
			continue
		}
		id, _ := strconv.ParseInt(cols[0], 10, 64)
		row := DomainRow{ID: id, Name: cols[1]}
		if hasActive && len(cols) > 2 {
			row.Active = boolPtr(cols[2])
		}
		rows = append(rows, row)
	}
	return rows, nil
}
func (s *Server) addDomain(ctx context.Context, domain string) error {
	if !domainRe.MatchString(domain) {
		return fmt.Errorf("invalid domain")
	}
	hasActive, err := s.columnExists(ctx, "virtual_domains", "active")
	if err != nil {
		return err
	}
	q := ""
	if hasActive {
		q = fmt.Sprintf("INSERT INTO virtual_domains(name,active) VALUES(%s,1) ON DUPLICATE KEY UPDATE active=1;", s.sqlQuote(domain))
	} else {
		q = fmt.Sprintf("INSERT INTO virtual_domains(name) VALUES(%s) ON DUPLICATE KEY UPDATE name=VALUES(name);", s.sqlQuote(domain))
	}
	_, err = s.execSQL(ctx, "admin", q)
	return err
}
func (s *Server) setDomainActive(ctx context.Context, domain string, active bool) error {
	hasActive, err := s.columnExists(ctx, "virtual_domains", "active")
	if err != nil {
		return err
	}
	if !hasActive {
		return fmt.Errorf("virtual_domains.active not found")
	}
	val := 0
	if active {
		val = 1
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("UPDATE virtual_domains SET active=%d WHERE name=%s;", val, s.sqlQuote(domain)))
	return err
}
func (s *Server) listMailboxes(ctx context.Context) ([]MailboxRow, error) {
	hasActive, err := s.columnExists(ctx, "virtual_users", "active")
	if err != nil {
		return nil, err
	}
	q := "SELECT id,email"
	if hasActive {
		q += ",active"
	}
	q += " FROM virtual_users ORDER BY email;"
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	rows := []MailboxRow{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 2 {
			continue
		}
		id, _ := strconv.ParseInt(cols[0], 10, 64)
		row := MailboxRow{ID: id, Email: cols[1]}
		if hasActive && len(cols) > 2 {
			row.Active = boolPtr(cols[2])
		}
		rows = append(rows, row)
	}
	return rows, nil
}
func (s *Server) addMailbox(ctx context.Context, email, plain string) (string, error) {
	if !emailRe.MatchString(email) {
		return "", fmt.Errorf("invalid email")
	}
	domain, _ := domainFromEmail(email)
	did, err := s.domainID(ctx, domain)
	if err != nil {
		return "", err
	}
	exists, err := s.execSQL(ctx, "ro", "SELECT COUNT(*) FROM virtual_users WHERE email="+s.sqlQuote(email)+";")
	if err != nil {
		return "", err
	}
	n, _ := strconv.Atoi(strings.TrimSpace(exists))
	if n > 0 {
		return "", fmt.Errorf("user already exists")
	}
	hash, err := s.hashPassword(ctx, plain)
	if err != nil {
		return "", err
	}
	hasActive, err := s.columnExists(ctx, "virtual_users", "active")
	if err != nil {
		return "", err
	}
	q := ""
	if hasActive {
		q = fmt.Sprintf("INSERT INTO virtual_users(domain_id,email,password,active) VALUES(%d,%s,%s,1);", did, s.sqlQuote(email), s.sqlQuote(hash))
	} else {
		q = fmt.Sprintf("INSERT INTO virtual_users(domain_id,email,password) VALUES(%d,%s,%s);", did, s.sqlQuote(email), s.sqlQuote(hash))
	}
	_, err = s.execSQL(ctx, "admin", q)
	return email, err
}
func (s *Server) deleteMailbox(ctx context.Context, email string) error {
	_, err := s.execSQL(ctx, "admin", "DELETE FROM virtual_users WHERE email="+s.sqlQuote(email)+";")
	return err
}
func (s *Server) setMailboxActive(ctx context.Context, email string, active bool) error {
	hasActive, err := s.columnExists(ctx, "virtual_users", "active")
	if err != nil {
		return err
	}
	if !hasActive {
		return fmt.Errorf("virtual_users.active not found")
	}
	val := 0
	if active {
		val = 1
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("UPDATE virtual_users SET active=%d WHERE email=%s;", val, s.sqlQuote(email)))
	return err
}
func (s *Server) updateMailboxPassword(ctx context.Context, email, plain string) error {
	hash, err := s.hashPassword(ctx, plain)
	if err != nil {
		return err
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("UPDATE virtual_users SET password=%s WHERE email=%s;", s.sqlQuote(hash), s.sqlQuote(email)))
	return err
}
func (s *Server) listAliases(ctx context.Context) ([]AliasRow, error) {
	hasActive, err := s.columnExists(ctx, "virtual_aliases", "active")
	if err != nil {
		return nil, err
	}
	q := "SELECT source,destination"
	if hasActive {
		q += ",active"
	}
	q += " FROM virtual_aliases ORDER BY source;"
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	rows := []AliasRow{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 2 {
			continue
		}
		row := AliasRow{Source: cols[0], Destination: cols[1]}
		if hasActive && len(cols) > 2 {
			row.Active = boolPtr(cols[2])
		}
		rows = append(rows, row)
	}
	return rows, nil
}
func (s *Server) upsertAlias(ctx context.Context, source, destination string) error {
	if !emailRe.MatchString(source) || !emailRe.MatchString(destination) {
		return fmt.Errorf("invalid alias email")
	}
	hasActive, err := s.columnExists(ctx, "virtual_aliases", "active")
	if err != nil {
		return err
	}
	_, err = s.execSQL(ctx, "admin", "DELETE FROM virtual_aliases WHERE source="+s.sqlQuote(source)+";")
	if err != nil {
		return err
	}
	if hasActive {
		_, err = s.execSQL(ctx, "admin", fmt.Sprintf("INSERT INTO virtual_aliases(source,destination,active) VALUES(%s,%s,1);", s.sqlQuote(source), s.sqlQuote(destination)))
	} else {
		_, err = s.execSQL(ctx, "admin", fmt.Sprintf("INSERT INTO virtual_aliases(source,destination) VALUES(%s,%s);", s.sqlQuote(source), s.sqlQuote(destination)))
	}
	return err
}
func (s *Server) deleteAlias(ctx context.Context, source string) error {
	_, err := s.execSQL(ctx, "admin", "DELETE FROM virtual_aliases WHERE source="+s.sqlQuote(source)+";")
	return err
}
func (s *Server) setAliasActive(ctx context.Context, source string, active bool) error {
	hasActive, err := s.columnExists(ctx, "virtual_aliases", "active")
	if err != nil {
		return err
	}
	if !hasActive {
		return fmt.Errorf("virtual_aliases.active not found")
	}
	val := 0
	if active {
		val = 1
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("UPDATE virtual_aliases SET active=%d WHERE source=%s;", val, s.sqlQuote(source)))
	return err
}
func (s *Server) ensureSystemAliases(ctx context.Context, domain, target string) error {
	for _, local := range []string{"postmaster", "abuse", "dmarc", "tlsrpt"} {
		if err := s.upsertAlias(ctx, local+"@"+domain, target); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) listWorkspaceRows(ctx context.Context, activeOnly bool) ([]WorkspaceRow, error) {
	q := "SELECT id,slug,name,COALESCE(default_domain,''),is_active FROM app_workspaces"
	if activeOnly {
		q += " WHERE is_active=1"
	}
	q += " ORDER BY slug;"
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	rows := []WorkspaceRow{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 5 {
			continue
		}
		id, _ := strconv.ParseInt(cols[0], 10, 64)
		row := WorkspaceRow{ID: id, Slug: cols[1], Name: cols[2], DefaultDomain: cols[3], Active: strings.TrimSpace(cols[4]) == "1"}
		row.Domains, _ = s.listWorkspaceDomains(ctx, row.Slug)
		rows = append(rows, row)
	}
	return rows, nil
}
func (s *Server) listWorkspaceDomains(ctx context.Context, slug string) ([]string, error) {
	q := fmt.Sprintf("SELECT d.domain_name FROM app_workspace_domains d JOIN app_workspaces w ON w.id=d.workspace_id WHERE w.slug=%s ORDER BY d.domain_name;", s.sqlQuote(slug))
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	items := []string{}
	for _, line := range splitLines(out) {
		items = append(items, strings.TrimSpace(line))
	}
	return items, nil
}
func (s *Server) workspaceExists(ctx context.Context, slug string) (WorkspaceRow, bool, error) {
	q := fmt.Sprintf("SELECT id,slug,name,COALESCE(default_domain,''),is_active FROM app_workspaces WHERE slug=%s LIMIT 1;", s.sqlQuote(slug))
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return WorkspaceRow{}, false, err
	}
	if strings.TrimSpace(out) == "" {
		return WorkspaceRow{}, false, nil
	}
	cols := strings.Split(out, "\t")
	id, _ := strconv.ParseInt(cols[0], 10, 64)
	row := WorkspaceRow{ID: id, Slug: cols[1], Name: cols[2], DefaultDomain: cols[3], Active: strings.TrimSpace(cols[4]) == "1"}
	row.Domains, _ = s.listWorkspaceDomains(ctx, slug)
	return row, true, nil
}
func (s *Server) createWorkspace(ctx context.Context, slug, name, defaultDomain string) error {
	if !usernameRe.MatchString(strings.ReplaceAll(slug, ".", "_")) {
		return fmt.Errorf("invalid workspace slug")
	}
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("workspace name required")
	}
	if defaultDomain != "" && !domainRe.MatchString(defaultDomain) {
		return fmt.Errorf("invalid default domain")
	}
	_, err := s.execSQL(ctx, "admin", fmt.Sprintf("INSERT INTO app_workspaces(slug,name,default_domain,is_active) VALUES(%s,%s,%s,1) ON DUPLICATE KEY UPDATE name=VALUES(name), default_domain=VALUES(default_domain), is_active=1;", s.sqlQuote(slug), s.sqlQuote(name), s.sqlQuote(defaultDomain)))
	if err != nil {
		return err
	}
	if defaultDomain != "" {
		return s.attachDomainToWorkspace(ctx, slug, defaultDomain)
	}
	return nil
}
func (s *Server) setWorkspaceActive(ctx context.Context, slug string, active bool) error {
	val := 0
	if active {
		val = 1
	}
	_, err := s.execSQL(ctx, "admin", fmt.Sprintf("UPDATE app_workspaces SET is_active=%d WHERE slug=%s;", val, s.sqlQuote(slug)))
	return err
}
func (s *Server) attachDomainToWorkspace(ctx context.Context, slug, domain string) error {
	if !domainRe.MatchString(domain) {
		return fmt.Errorf("invalid domain")
	}
	row, found, err := s.workspaceExists(ctx, slug)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("workspace not found")
	}
	if _, err := s.domainID(ctx, domain); err != nil {
		return err
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("INSERT INTO app_workspace_domains(workspace_id,domain_name) VALUES(%d,%s) ON DUPLICATE KEY UPDATE workspace_id=VALUES(workspace_id);", row.ID, s.sqlQuote(domain)))
	return err
}
func (s *Server) workspaceOwnsDomain(ctx context.Context, slug, domain string) (bool, error) {
	q := fmt.Sprintf("SELECT COUNT(*) FROM app_workspace_domains d JOIN app_workspaces w ON w.id=d.workspace_id WHERE w.slug=%s AND w.is_active=1 AND d.domain_name=%s;", s.sqlQuote(slug), s.sqlQuote(domain))
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return false, err
	}
	n, _ := strconv.Atoi(strings.TrimSpace(out))
	return n > 0, nil
}
func (s *Server) mailboxInWorkspace(ctx context.Context, slug, email string) (bool, error) {
	domain, err := domainFromEmail(email)
	if err != nil {
		return false, err
	}
	return s.workspaceOwnsDomain(ctx, slug, domain)
}
func (s *Server) listDestinationAliases(ctx context.Context, email string) ([]AliasRow, error) {
	hasActive, err := s.columnExists(ctx, "virtual_aliases", "active")
	if err != nil {
		return nil, err
	}
	q := "SELECT source,destination"
	if hasActive {
		q += ",active"
	}
	q += " FROM virtual_aliases WHERE destination=" + s.sqlQuote(email) + " ORDER BY source;"
	out, err := s.execSQL(ctx, "ro", q)
	if err != nil {
		return nil, err
	}
	items := []AliasRow{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 2 {
			continue
		}
		row := AliasRow{Source: cols[0], Destination: cols[1]}
		if hasActive && len(cols) > 2 {
			row.Active = boolPtr(cols[2])
		}
		items = append(items, row)
	}
	return items, nil
}
func (s *Server) portalAccountSummary(ctx context.Context, workspaceSlug, email string) (map[string]any, error) {
	ws, found, err := s.workspaceExists(ctx, workspaceSlug)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("workspace not found")
	}
	domain, _ := domainFromEmail(email)
	aliases, _ := s.listDestinationAliases(ctx, email)
	_, active, foundMailbox, err := s.mailboxLookup(ctx, email)
	if err != nil {
		return nil, err
	}
	if !foundMailbox {
		return nil, fmt.Errorf("mailbox not found")
	}
	return map[string]any{"email": email, "domain": domain, "active": active, "workspace_slug": ws.Slug, "workspace_name": ws.Name, "default_domain": ws.DefaultDomain, "service_host": s.cfg.MailHost, "imap_ssl_port": 993, "smtp_tls_port": 587, "smtp_ssl_port": 465, "alias_count": len(aliases), "aliases": aliases}, nil
}
func tenantParts(path string) (slug, section, action string, ok bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/v1/tenants/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], strings.Join(parts[2:], "/"), true
}
func trimPrefix(v, prefix string) string { return strings.TrimPrefix(v, prefix) }
func trimAnyPrefix(v string, prefixes ...string) string {
	for _, p := range prefixes {
		if strings.HasPrefix(v, p) {
			return strings.TrimPrefix(v, p)
		}
	}
	return v
}

type imapConn struct {
	conn net.Conn
	rd   *bufio.Reader
	wr   *bufio.Writer
	tag  int
}

var (
	literalLineRe      = regexp.MustCompile(`\{(\d+)\}\r\n$`)
	literalBlockRe     = regexp.MustCompile(`\{(\d+)\}\r\n`)
	errLiteralTooLarge = errors.New("message too large")
)

func newIMAPConn(ctx context.Context, host string, port int) (*imapConn, error) {
	d := &net.Dialer{Timeout: 8 * time.Second}
	conn, err := tls.DialWithDialer(d, "tcp", fmt.Sprintf("%s:%d", host, port), &tls.Config{
		ServerName:         host,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: false,
	})
	if err != nil {
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	}
	c := &imapConn{conn: conn, rd: bufio.NewReader(conn), wr: bufio.NewWriter(conn)}
	greet, err := c.rd.ReadString('\n')
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if !strings.Contains(strings.ToUpper(greet), "OK") {
		_ = conn.Close()
		return nil, fmt.Errorf("imap greeting failed")
	}
	return c, nil
}

func (c *imapConn) close() {
	_ = c.conn.Close()
}

func (c *imapConn) run(command string) (string, error) {
	return c.runLimited(command, 0)
}

func (c *imapConn) runLimited(command string, maxLiteralBytes int) (string, error) {
	c.tag++
	tag := fmt.Sprintf("A%04d", c.tag)
	if _, err := c.wr.WriteString(tag + " " + command + "\r\n"); err != nil {
		return "", err
	}
	if err := c.wr.Flush(); err != nil {
		return "", err
	}
	var out bytes.Buffer
	for {
		line, err := c.rd.ReadString('\n')
		if err != nil {
			return "", err
		}
		out.WriteString(line)
		if m := literalLineRe.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			if maxLiteralBytes > 0 {
				if n > maxLiteralBytes {
					if _, err := io.CopyN(io.Discard, c.rd, int64(n)); err != nil {
						return "", err
					}
					return out.String(), errLiteralTooLarge
				}
				maxLiteralBytes -= n
			}
			if n > 0 {
				buf := make([]byte, n)
				if _, err := io.ReadFull(c.rd, buf); err != nil {
					return "", err
				}
				out.Write(buf)
			}
			continue
		}
		if strings.HasPrefix(line, tag+" ") {
			if !strings.Contains(strings.ToUpper(line), "OK") {
				return out.String(), fmt.Errorf("imap command failed: %s", strings.TrimSpace(line))
			}
			return out.String(), nil
		}
	}
}

func extractLiterals(raw string) [][]byte {
	out := [][]byte{}
	rest := raw
	for {
		loc := literalBlockRe.FindStringSubmatchIndex(rest)
		if loc == nil {
			break
		}
		sizeText := rest[loc[2]:loc[3]]
		n, err := strconv.Atoi(sizeText)
		if err != nil || n < 0 {
			break
		}
		bodyStart := loc[1]
		if bodyStart+n > len(rest) {
			break
		}
		out = append(out, []byte(rest[bodyStart:bodyStart+n]))
		rest = rest[bodyStart+n:]
	}
	return out
}

func parseHeaderBlock(raw []byte) map[string]string {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return map[string]string{}
	}
	return map[string]string{
		"from":    msg.Header.Get("From"),
		"to":      msg.Header.Get("To"),
		"subject": msg.Header.Get("Subject"),
		"date":    msg.Header.Get("Date"),
	}
}

func normalizePreview(raw string, limit int) string {
	body := strings.ReplaceAll(raw, "\r", "")
	lines := []string{}
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			continue
		}
		lines = append(lines, t)
		if len(strings.Join(lines, " ")) >= limit {
			break
		}
	}
	joined := strings.Join(lines, " ")
	r := []rune(joined)
	if len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return joined
}

func readRedisResponse(rd *bufio.Reader) (string, error) {
	line, err := rd.ReadString('\n')
	if err != nil {
		return "", err
	}
	if len(line) == 0 {
		return "", fmt.Errorf("empty redis response")
	}
	switch line[0] {
	case '+', ':':
		return strings.TrimSpace(line[1:]), nil
	case '-':
		return "", fmt.Errorf(strings.TrimSpace(line[1:]))
	case '$':
		n, convErr := strconv.Atoi(strings.TrimSpace(line[1:]))
		if convErr != nil {
			return "", convErr
		}
		if n < 0 {
			return "", nil
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(rd, buf); err != nil {
			return "", err
		}
		return string(buf[:n]), nil
	case '*':
		n, convErr := strconv.Atoi(strings.TrimSpace(line[1:]))
		if convErr != nil || n <= 0 {
			return "", convErr
		}
		items := make([]string, 0, n)
		for i := 0; i < n; i++ {
			ln, err := rd.ReadString('\n')
			if err != nil {
				return "", err
			}
			if len(ln) == 0 || ln[0] != '$' {
				continue
			}
			l, _ := strconv.Atoi(strings.TrimSpace(ln[1:]))
			if l < 0 {
				continue
			}
			b := make([]byte, l+2)
			if _, err := io.ReadFull(rd, b); err != nil {
				return "", err
			}
			items = append(items, string(b[:l]))
		}
		return strings.Join(items, "\n"), nil
	default:
		return "", fmt.Errorf("unexpected redis response: %q", line)
	}
}

func (s *Server) redisRun(ctx context.Context, args ...string) (string, error) {
	addr := strings.TrimSpace(s.cfg.RedisAddr)
	if addr == "" {
		return "", fmt.Errorf("REDIS_ADDR is required")
	}
	d := net.Dialer{Timeout: 3 * time.Second}
	network := s.cfg.RedisNetwork
	if network == "" {
		network = "tcp"
	}
	conn, err := d.DialContext(ctx, network, addr)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	rd := bufio.NewReader(conn)
	if s.cfg.RedisPassword != "" {
		if _, err := fmt.Fprintf(conn, "*2\r\n$4\r\nAUTH\r\n$%d\r\n%s\r\n", len(s.cfg.RedisPassword), s.cfg.RedisPassword); err != nil {
			return "", err
		}
		if _, err := readRedisResponse(rd); err != nil {
			return "", err
		}
	}
	if s.cfg.RedisDB > 0 {
		dbText := strconv.Itoa(s.cfg.RedisDB)
		if _, err := fmt.Fprintf(conn, "*2\r\n$6\r\nSELECT\r\n$%d\r\n%s\r\n", len(dbText), dbText); err != nil {
			return "", err
		}
		if _, err := readRedisResponse(rd); err != nil {
			return "", err
		}
	}
	if _, err := fmt.Fprintf(conn, "*%d\r\n", len(args)); err != nil {
		return "", err
	}
	for _, a := range args {
		if _, err := fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(a), a); err != nil {
			return "", err
		}
	}
	return readRedisResponse(rd)
}

func (s *Server) encryptWebmailPassword(plain string) (string, error) {
	block, err := aes.NewCipher(s.webmailEncKey[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plain), nil)
	return base64.RawURLEncoding.EncodeToString(nonce) + "." + base64.RawURLEncoding.EncodeToString(ciphertext), nil
}

func (s *Server) decryptWebmailPassword(raw string) (string, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid password ciphertext")
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.webmailEncKey[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

var errWebmailAccountAlreadyConnected = errors.New("mailbox already connected")
var errWebmailAccountLimitReached = errors.New("max connected mailbox limit reached")

func (s *Server) webmailSessionAccountsKey(sessionID string) string {
	return "mailops:webmail:session:" + strings.TrimSpace(sessionID) + ":accounts"
}

func (s *Server) webmailSessionAccountKey(sessionID, accountID string) string {
	return "mailops:webmail:session:" + strings.TrimSpace(sessionID) + ":account:" + strings.TrimSpace(accountID)
}

func (s *Server) webmailSessionEmailKey(sessionID, email string) string {
	return "mailops:webmail:session:" + strings.TrimSpace(sessionID) + ":email:" + strings.ToLower(strings.TrimSpace(email))
}

func (s *Server) webmailMailboxSessionsKey(email string) string {
	return "mailops:webmail:mailbox:" + strings.ToLower(strings.TrimSpace(email)) + ":sessions"
}

func (s *Server) createWebmailAccount(ctx context.Context, sess *Session, email, password, passwordHash string) (WebmailAccount, error) {
	accountIDToken, err := randomTokenHex(8)
	if err != nil {
		return WebmailAccount{}, err
	}
	accountID := "acc_" + accountIDToken
	ciphertext, err := s.encryptWebmailPassword(password)
	if err != nil {
		return WebmailAccount{}, err
	}
	domain := ""
	if at := strings.LastIndex(email, "@"); at > 0 {
		domain = strings.ToLower(strings.TrimSpace(email[at+1:]))
	}
	exp := time.Now().Add(time.Duration(s.cfg.WebmailAccountTTLSeconds) * time.Second).Unix()
	account := WebmailAccount{
		AccountID:          accountID,
		Email:              strings.ToLower(strings.TrimSpace(email)),
		Workspace:          sess.Workspace,
		Domain:             domain,
		PasswordCiphertext: ciphertext,
		PasswordHash:       passwordHash,
		ConnectedAt:        time.Now().Unix(),
		ExpiresAt:          exp,
	}
	raw, err := json.Marshal(account)
	if err != nil {
		return WebmailAccount{}, err
	}
	ttl := strconv.FormatInt(max(60, s.cfg.WebmailAccountTTLSeconds), 10)
	sessionAccountsKey := s.webmailSessionAccountsKey(sess.SessionID)
	sessionAccountKey := s.webmailSessionAccountKey(sess.SessionID, accountID)
	sessionEmailKey := s.webmailSessionEmailKey(sess.SessionID, email)
	mailboxSessionsKey := s.webmailMailboxSessionsKey(email)
	accountKeyPrefix := "mailops:webmail:session:" + strings.TrimSpace(sess.SessionID) + ":account:"
	script := `
local max_accounts = tonumber(ARGV[5])
local account_key_prefix = ARGV[6]

if max_accounts == nil or max_accounts < 1 then
  max_accounts = 1
end

local ids = redis.call("SMEMBERS", KEYS[3])
local active_count = 0

for _, id in ipairs(ids) do
  local account_key = account_key_prefix .. id
  if redis.call("EXISTS", account_key) == 1 then
    active_count = active_count + 1
  else
    redis.call("SREM", KEYS[3], id)
  end
end

local existing_id = redis.call("GET", KEYS[2])
if existing_id and existing_id ~= false and existing_id ~= "" then
  local existing_key = account_key_prefix .. existing_id
  if redis.call("EXISTS", existing_key) == 1 then
    redis.call("SADD", KEYS[3], existing_id)
    redis.call("EXPIRE", KEYS[3], ARGV[2])
    return "DUPLICATE"
  end

  redis.call("DEL", KEYS[2])
  redis.call("SREM", KEYS[3], existing_id)
end

if active_count >= max_accounts then
  return "LIMIT"
end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[2])
redis.call("SADD", KEYS[3], ARGV[3])
redis.call("EXPIRE", KEYS[3], ARGV[2])
redis.call("SADD", KEYS[4], ARGV[4])
redis.call("EXPIRE", KEYS[4], ARGV[2])

return "OK"
`
	setResult, err := s.redisRun(
		ctx,
		"EVAL",
		script,
		"4",
		sessionAccountKey,
		sessionEmailKey,
		sessionAccountsKey,
		mailboxSessionsKey,
		string(raw),
		ttl,
		accountID,
		sess.SessionID,
		strconv.Itoa(max(1, s.cfg.WebmailMaxAccounts)),
		accountKeyPrefix,
	)
	if err != nil {
		return WebmailAccount{}, err
	}
	switch strings.ToUpper(strings.TrimSpace(setResult)) {
	case "OK":
	case "DUPLICATE":
		return WebmailAccount{}, errWebmailAccountAlreadyConnected
	case "LIMIT":
		return WebmailAccount{}, errWebmailAccountLimitReached
	default:
		return WebmailAccount{}, fmt.Errorf("unexpected redis eval result: %s", strings.TrimSpace(setResult))
	}
	return account, nil
}

func (s *Server) listWebmailAccounts(ctx context.Context, sessionID string) ([]WebmailAccount, error) {
	idsRaw, err := s.redisRun(ctx, "SMEMBERS", s.webmailSessionAccountsKey(sessionID))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(idsRaw) == "" {
		return []WebmailAccount{}, nil
	}
	ids := strings.Split(idsRaw, "\n")
	items := make([]WebmailAccount, 0, len(ids))
	for _, id := range ids {
		accountID := strings.TrimSpace(id)
		if accountID == "" {
			continue
		}
		accountKey := s.webmailSessionAccountKey(sessionID, accountID)
		raw, err := s.redisRun(ctx, "GET", accountKey)
		if err != nil {
			continue
		}
		if strings.TrimSpace(raw) == "" {
			_, _ = s.redisRun(ctx, "SREM", s.webmailSessionAccountsKey(sessionID), accountID)
			continue
		}
		var item WebmailAccount
		if json.Unmarshal([]byte(raw), &item) != nil {
			_, _ = s.redisRun(ctx, "SREM", s.webmailSessionAccountsKey(sessionID), accountID)
			_, _ = s.redisRun(ctx, "DEL", accountKey)
			continue
		}
		if item.AccountID == "" || item.AccountID != accountID {
			if strings.TrimSpace(item.Email) != "" {
				emailKey := s.webmailSessionEmailKey(sessionID, item.Email)
				mappedID, mapErr := s.redisRun(ctx, "GET", emailKey)

				if mapErr == nil && strings.TrimSpace(mappedID) == accountID {
					_, _ = s.redisRun(ctx, "DEL", emailKey)
					_, _ = s.redisRun(ctx, "SREM", s.webmailMailboxSessionsKey(item.Email), sessionID)
				}
			}

			_, _ = s.redisRun(ctx, "SREM", s.webmailSessionAccountsKey(sessionID), accountID)
			_, _ = s.redisRun(ctx, "DEL", accountKey)
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ConnectedAt == items[j].ConnectedAt {
			return items[i].Email < items[j].Email
		}
		return items[i].ConnectedAt < items[j].ConnectedAt
	})
	return items, nil
}

func (s *Server) getWebmailAccount(ctx context.Context, sessionID, accountID string) (WebmailAccount, error) {
	raw, err := s.redisRun(ctx, "GET", s.webmailSessionAccountKey(sessionID, accountID))
	if err != nil || strings.TrimSpace(raw) == "" {
		return WebmailAccount{}, fmt.Errorf("account not found")
	}
	var account WebmailAccount
	if err := json.Unmarshal([]byte(raw), &account); err != nil {
		return WebmailAccount{}, err
	}
	if account.AccountID == "" {
		return WebmailAccount{}, fmt.Errorf("account not found")
	}
	return account, nil
}

func (s *Server) removeWebmailAccount(ctx context.Context, sessionID, accountID string) {
	account, err := s.getWebmailAccount(ctx, sessionID, accountID)
	if err == nil && strings.TrimSpace(account.Email) != "" {
		_, _ = s.redisRun(ctx, "SREM", s.webmailMailboxSessionsKey(account.Email), sessionID)
		_, _ = s.redisRun(ctx, "DEL", s.webmailSessionEmailKey(sessionID, account.Email))
	}
	_, _ = s.redisRun(ctx, "SREM", s.webmailSessionAccountsKey(sessionID), accountID)
	_, _ = s.redisRun(ctx, "DEL", s.webmailSessionAccountKey(sessionID, accountID))
}

func (s *Server) revokeWebmailAccountsForMailbox(ctx context.Context, email string) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return
	}
	sessionsRaw, err := s.redisRun(ctx, "SMEMBERS", s.webmailMailboxSessionsKey(email))
	if err == nil && strings.TrimSpace(sessionsRaw) != "" {
		for _, sidLine := range strings.Split(sessionsRaw, "\n") {
			sessionID := strings.TrimSpace(sidLine)
			if sessionID == "" {
				continue
			}
			accounts, listErr := s.listWebmailAccounts(ctx, sessionID)
			if listErr != nil {
				continue
			}
			for _, account := range accounts {
				if strings.EqualFold(account.Email, email) {
					s.removeWebmailAccount(ctx, sessionID, account.AccountID)
				}
			}
		}
	}
	_, _ = s.redisRun(ctx, "DEL", s.webmailMailboxSessionsKey(email))
}

func (s *Server) clearWebmailSessionAccounts(ctx context.Context, sessionID string) {
	accounts, _ := s.listWebmailAccounts(ctx, sessionID)
	for _, account := range accounts {
		s.removeWebmailAccount(ctx, sessionID, account.AccountID)
	}
	_, _ = s.redisRun(ctx, "DEL", s.webmailSessionAccountsKey(sessionID))
}

func (s *Server) sanitizeWebmailAccount(account WebmailAccount) map[string]any {
	return map[string]any{
		"account_id": account.AccountID,
		"email":      account.Email,
		"workspace":  account.Workspace,
		"domain":     account.Domain,
		"connected":  account.ConnectedAt,
		"expires_at": account.ExpiresAt,
	}
}

func normalizeIMAPFolder(raw string) (string, error) {
	folder := strings.TrimSpace(raw)
	if folder == "" {
		return "", fmt.Errorf("folder is required")
	}
	if strings.EqualFold(folder, "INBOX") {
		return "INBOX", nil
	}
	if strings.ContainsAny(folder, "\r\n\"\\") {
		return "", fmt.Errorf("invalid folder")
	}
	if len(folder) > 128 {
		return "", fmt.Errorf("folder too long")
	}
	return folder, nil
}

func (s *Server) resolveWebmailAccount(ctx context.Context, sess *Session, accountID string) (WebmailAccount, string, error) {
	account, err := s.getWebmailAccount(ctx, sess.SessionID, accountID)
	if err != nil {
		return WebmailAccount{}, "", fmt.Errorf("account not found")
	}
	if account.AccountID != accountID || account.Workspace != sess.Workspace {
		s.removeWebmailAccount(ctx, sess.SessionID, accountID)
		return WebmailAccount{}, "", fmt.Errorf("mailbox session invalid")
	}
	hash, active, found, err := s.mailboxLookup(ctx, account.Email)
	if err != nil {
		return WebmailAccount{}, "", err
	}
	if !found || !active || hash != account.PasswordHash {
		s.removeWebmailAccount(ctx, sess.SessionID, accountID)
		return WebmailAccount{}, "", fmt.Errorf("mailbox session invalid")
	}
	password, err := s.decryptWebmailPassword(account.PasswordCiphertext)
	if err != nil {
		s.removeWebmailAccount(ctx, sess.SessionID, accountID)
		return WebmailAccount{}, "", fmt.Errorf("mailbox session invalid")
	}
	return account, password, nil
}

type webmailAccountState int

const (
	webmailAccountValid webmailAccountState = iota
	webmailAccountInvalid
	webmailAccountLookupError
)

func (s *Server) validateWebmailAccountState(ctx context.Context, sess *Session, account WebmailAccount) (webmailAccountState, error) {
	if account.AccountID == "" || account.Workspace != sess.Workspace {
		s.removeWebmailAccount(ctx, sess.SessionID, account.AccountID)
		return webmailAccountInvalid, nil
	}
	hash, active, found, err := s.mailboxLookup(ctx, account.Email)
	if err != nil {
		return webmailAccountLookupError, err
	}
	if !found || !active || hash != account.PasswordHash {
		s.removeWebmailAccount(ctx, sess.SessionID, account.AccountID)
		return webmailAccountInvalid, nil
	}
	return webmailAccountValid, nil
}

func (s *Server) portalInbox(ctx context.Context, mailboxEmail, password string, limit int) ([]WebmailMessage, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	c, err := newIMAPConn(ctx, s.cfg.MailHost, 993)
	if err != nil {
		return nil, err
	}
	defer c.close()
	if _, err := c.run(fmt.Sprintf(`LOGIN %q %q`, mailboxEmail, password)); err != nil {
		return nil, err
	}
	defer c.run("LOGOUT")
	if _, err := c.run("SELECT INBOX"); err != nil {
		return nil, err
	}
	searchRaw, err := c.run("UID SEARCH ALL")
	if err != nil {
		return nil, err
	}
	seqs := []int{}
	for _, line := range splitLines(strings.ReplaceAll(searchRaw, "\r", "")) {
		if !strings.HasPrefix(line, "* SEARCH") {
			continue
		}
		parts := strings.Fields(strings.TrimPrefix(line, "* SEARCH"))
		for _, p := range parts {
			n, convErr := strconv.Atoi(strings.TrimSpace(p))
			if convErr == nil && n > 0 {
				seqs = append(seqs, n)
			}
		}
	}
	if len(seqs) == 0 {
		return []WebmailMessage{}, nil
	}
	sort.Ints(seqs)
	start := 0
	if len(seqs) > limit {
		start = len(seqs) - limit
	}
	selected := seqs[start:]
	for i, j := 0, len(selected)-1; i < j; i, j = i+1, j-1 {
		selected[i], selected[j] = selected[j], selected[i]
	}
	items := make([]WebmailMessage, 0, len(selected))
	for _, seq := range selected {
		raw, fetchErr := c.run(fmt.Sprintf("UID FETCH %d (UID RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT])", seq))
		if fetchErr != nil {
			continue
		}
		literals := extractLiterals(raw)
		headers := map[string]string{}
		preview := ""
		if len(literals) > 0 {
			headers = parseHeaderBlock(literals[0])
		}
		if len(literals) > 1 {
			preview = normalizePreview(string(literals[1]), 160)
		}
		uid := ""
		if m := regexp.MustCompile(`UID\s+([0-9]+)`).FindStringSubmatch(raw); len(m) > 1 {
			uid = m[1]
		}
		size := int64(0)
		if m := regexp.MustCompile(`RFC822\.SIZE\s+([0-9]+)`).FindStringSubmatch(raw); len(m) > 1 {
			size, _ = strconv.ParseInt(m[1], 10, 64)
		}
		items = append(items, WebmailMessage{
			UID: uid, From: headers["from"], To: headers["to"], Subject: headers["subject"], Date: headers["date"], Size: size, Preview: preview,
		})
	}
	return items, nil
}

func (s *Server) portalMessage(ctx context.Context, mailboxEmail, password, folder, uid string) (map[string]any, error) {
	safeFolder, err := normalizeIMAPFolder(folder)
	if err != nil {
		return nil, err
	}
	c, err := newIMAPConn(ctx, s.cfg.MailHost, 993)
	if err != nil {
		return nil, err
	}
	defer c.close()
	if _, err := c.run(fmt.Sprintf(`LOGIN %q %q`, mailboxEmail, password)); err != nil {
		return nil, err
	}
	shouldLogout := true
	defer func() {
		if shouldLogout {
			_, _ = c.run("LOGOUT")
		}
	}()
	if _, err := c.run(fmt.Sprintf("SELECT %q", safeFolder)); err != nil {
		return nil, err
	}
	raw, err := c.runLimited(fmt.Sprintf("UID FETCH %s (UID RFC822.SIZE BODY.PEEK[])", strings.TrimSpace(uid)), 15*1024*1024)
	if err != nil {
		if errors.Is(err, errLiteralTooLarge) {
			shouldLogout = false
		}
		return nil, err
	}
	literals := extractLiterals(raw)
	if !regexp.MustCompile(`UID\s+([0-9]+)`).MatchString(raw) || len(literals) == 0 {
		return nil, fmt.Errorf("message not found")
	}
	parsed, err := parseMIMEEmail(literals[0], 2*1024*1024)
	if err != nil {
		return nil, err
	}
	parsedUID := strings.TrimSpace(uid)
	if m := regexp.MustCompile(`UID\s+([0-9]+)`).FindStringSubmatch(raw); len(m) > 1 {
		parsedUID = m[1]
	}
	size := int64(0)
	if m := regexp.MustCompile(`RFC822\.SIZE\s+([0-9]+)`).FindStringSubmatch(raw); len(m) > 1 {
		size, _ = strconv.ParseInt(m[1], 10, 64)
	}
	return map[string]any{
		"uid": parsedUID, "from": parsed.From, "to": parsed.To, "subject": parsed.Subject, "date": parsed.Date, "size": size, "text": parsed.Text, "html": parsed.HTML, "attachments": parsed.Attachments,
	}, nil
}

func (s *Server) portalSendMail(ctx context.Context, mailboxEmail, password, to, subject, body string) error {
	host := s.cfg.MailHost
	addr := fmt.Sprintf("%s:%d", host, 587)
	c, err := smtp.Dial(addr)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
		return err
	}
	if err := c.Auth(smtp.PlainAuth("", mailboxEmail, password, host)); err != nil {
		return err
	}
	if err := c.Mail(mailboxEmail); err != nil {
		return err
	}
	rcpts := []string{}
	for _, p := range strings.Split(to, ",") {
		t := strings.TrimSpace(p)
		if t == "" {
			continue
		}
		if !emailRe.MatchString(t) {
			return fmt.Errorf("invalid recipient: %s", t)
		}
		rcpts = append(rcpts, t)
	}
	if len(rcpts) == 0 {
		return fmt.Errorf("recipient is required")
	}
	for _, rcpt := range rcpts {
		if err := c.Rcpt(rcpt); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n",
		mailboxEmail, strings.Join(rcpts, ", "), sanitizeMailHeader(subject), time.Now().Format(time.RFC1123Z), body)
	if _, err := io.WriteString(w, msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func sanitizeMailHeader(v string) string {
	v = strings.ReplaceAll(v, "\r", " ")
	v = strings.ReplaceAll(v, "\n", " ")
	return strings.TrimSpace(v)
}

func parseIMAPInternalDate(raw string) string {
	m := regexp.MustCompile(`INTERNALDATE\s+"([^"]+)"`).FindStringSubmatch(raw)
	if len(m) < 2 {
		return ""
	}
	ts, err := time.Parse("_2-Jan-2006 15:04:05 -0700", m[1])
	if err != nil {
		return ""
	}
	return ts.UTC().Format(time.RFC3339)
}

func (s *Server) inboxForAccount(ctx context.Context, account WebmailAccount, password string, limit int) ([]InboxItem, error) {
	timeout := max(int64(3), s.cfg.WebmailIMAPTimeoutSeconds)
	cctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	c, err := newIMAPConn(cctx, s.cfg.MailHost, 993)
	if err != nil {
		return nil, err
	}
	defer c.close()
	if _, err := c.run(fmt.Sprintf(`LOGIN %q %q`, account.Email, password)); err != nil {
		return nil, err
	}
	defer c.run("LOGOUT")
	if _, err := c.run("SELECT INBOX"); err != nil {
		return nil, err
	}
	searchRaw, err := c.run("UID SEARCH ALL")
	if err != nil {
		return nil, err
	}
	uids := []int{}
	for _, line := range splitLines(strings.ReplaceAll(searchRaw, "\r", "")) {
		if !strings.HasPrefix(line, "* SEARCH") {
			continue
		}
		parts := strings.Fields(strings.TrimPrefix(line, "* SEARCH"))
		for _, p := range parts {
			n, convErr := strconv.Atoi(strings.TrimSpace(p))
			if convErr == nil && n > 0 {
				uids = append(uids, n)
			}
		}
	}
	if len(uids) == 0 {
		return []InboxItem{}, nil
	}
	sort.Ints(uids)
	start := 0
	if len(uids) > limit {
		start = len(uids) - limit
	}
	selected := uids[start:]
	for i, j := 0, len(selected)-1; i < j; i, j = i+1, j-1 {
		selected[i], selected[j] = selected[j], selected[i]
	}
	items := make([]InboxItem, 0, len(selected))
	for _, uid := range selected {
		raw, fetchErr := c.run(fmt.Sprintf("UID FETCH %d (UID RFC822.SIZE INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT])", uid))
		if fetchErr != nil {
			continue
		}
		literals := extractLiterals(raw)
		headers := map[string]string{}
		preview := ""
		if len(literals) > 0 {
			headers = parseHeaderBlock(literals[0])
		}
		if len(literals) > 1 {
			preview = normalizePreview(string(literals[1]), 180)
		}
		uidText := strconv.Itoa(uid)
		if m := regexp.MustCompile(`UID\s+([0-9]+)`).FindStringSubmatch(raw); len(m) > 1 {
			uidText = strings.TrimSpace(m[1])
		}
		size := int64(0)
		if m := regexp.MustCompile(`RFC822\.SIZE\s+([0-9]+)`).FindStringSubmatch(raw); len(m) > 1 {
			size, _ = strconv.ParseInt(m[1], 10, 64)
		}
		internalDate := parseIMAPInternalDate(raw)
		items = append(items, InboxItem{
			MessageID:    account.AccountID + ":INBOX:" + uidText,
			AccountID:    account.AccountID,
			AccountEmail: account.Email,
			Folder:       "INBOX",
			UID:          uidText,
			From:         headers["from"],
			To:           headers["to"],
			Subject:      headers["subject"],
			Date:         headers["date"],
			InternalDate: internalDate,
			Preview:      preview,
			Size:         size,
		})
	}
	return items, nil
}

// handlers
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) handleHealthReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	dbOK := s.checkMySQLReady(r.Context()) == nil
	redisOK := s.checkRedisReady(r.Context()) == nil
	ok := dbOK && redisOK
	status := http.StatusOK
	if !ok {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"ok":       ok,
		"db_ok":    dbOK,
		"redis_ok": redisOK,
		"time":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) checkMySQLReady(ctx context.Context) error {
	_, err := s.execSQL(ctx, "ro", "SELECT 1;")
	return err
}

func (s *Server) checkRedisReady(ctx context.Context) error {
	_, err := s.redisRun(ctx, "PING")
	return err
}
func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	var req struct{ Username, Password string }
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	loginKey := "admin|" + s.clientIP(r) + "|" + strings.ToLower(strings.TrimSpace(req.Username))
	if err := s.checkLoginRateLimit(loginKey); err != nil {
		writeErr(w, 429, "RATE_LIMITED", err.Error())
		return
	}
	hash, role, active, version, found, err := s.adminLookup(r.Context(), req.Username)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	if !found || !active || s.verifyHash(r.Context(), hash, req.Password) != nil {
		s.registerLoginFailure(loginKey)
		writeErr(w, 401, "AUTH_FAILED", "Invalid credentials")
		return
	}
	s.clearLoginFailure(loginKey)
	_ = s.setCookie(w, s.cfg.AdminCookieName, Session{Subject: req.Username, Kind: "admin", Version: version, Exp: time.Now().Add(time.Duration(s.cfg.SessionTTLSeconds) * time.Second).Unix()})
	_, _ = s.setCSRFCookie(w, "admin")
	s.audit(r.Context(), "admin", req.Username, "admin.login", s.clientIP(r), `{}`)
	writeJSON(w, 200, map[string]any{"ok": true, "username": req.Username, "role": role})
}
func (s *Server) handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	s.clearCookie(w, s.cfg.AdminCookieName)
	s.clearCSRFCookie(w, "admin")
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) handleAdminSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	allowed, err := s.allowedWorkspaceSlugs(r.Context(), sess)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	bindings := []BindingPermission{}
	if !s.isSuperadmin(sess) {
		bindings, err = s.adminWorkspaceBindings(r.Context(), sess.Subject)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
	}
	scope := "assigned"
	if s.isSuperadmin(sess) {
		scope = "platform"
	}
	writeJSON(w, 200, map[string]any{"ok": true, "username": sess.Subject, "role": sess.Role, "workspace_scope": scope, "allowed_workspaces": allowed, "permissions": bindings})
}
func (s *Server) handlePortalLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	var req struct{ Email, Password string }
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	if !emailRe.MatchString(req.Email) {
		writeErr(w, 400, "BAD_REQUEST", "Invalid email")
		return
	}
	loginKey := "portal|" + s.clientIP(r) + "|" + strings.ToLower(strings.TrimSpace(req.Email))
	if err := s.checkLoginRateLimit(loginKey); err != nil {
		writeErr(w, 429, "RATE_LIMITED", err.Error())
		return
	}
	workspaceSlug := strings.TrimSpace(r.Header.Get("X-Workspace-Slug"))
	if workspaceSlug == "" {
		workspaceSlug = "default"
	}
	if ok, err := s.mailboxInWorkspace(r.Context(), workspaceSlug, req.Email); err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	} else if !ok {
		writeErr(w, 403, "FORBIDDEN", "Mailbox is not in this workspace")
		return
	}
	hash, active, found, err := s.mailboxLookup(r.Context(), req.Email)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	if !found || !active || s.verifyHash(r.Context(), hash, req.Password) != nil {
		s.registerLoginFailure(loginKey)
		writeErr(w, 401, "AUTH_FAILED", "Invalid credentials")
		return
	}
	s.clearLoginFailure(loginKey)
	sid, _ := randomTokenHex(16)
	_ = s.setCookie(w, s.cfg.PortalCookieName, Session{Subject: req.Email, Kind: "portal", Workspace: workspaceSlug, SessionID: sid, Exp: time.Now().Add(time.Duration(s.cfg.SessionTTLSeconds) * time.Second).Unix()})
	_, _ = s.setCSRFCookie(w, "portal")
	s.audit(r.Context(), "mailbox", req.Email, "portal.login", s.clientIP(r), `{}`)
	writeJSON(w, 200, map[string]any{"ok": true, "email": req.Email, "workspace_slug": workspaceSlug})
}
func (s *Server) handlePortalLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	if sess, err := s.getSession(r, s.cfg.PortalCookieName, "portal"); err == nil {
		if strings.TrimSpace(sess.SessionID) != "" {
			s.clearWebmailSessionAccounts(r.Context(), sess.SessionID)
		}
	}
	s.clearCookie(w, s.cfg.PortalCookieName)
	s.clearCSRFCookie(w, "portal")
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) handlePortalSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	summary, err := s.portalAccountSummary(r.Context(), sess.Workspace, sess.Subject)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	summary["ok"] = true
	writeJSON(w, 200, summary)
}
func (s *Server) handlePortalProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	summary, err := s.portalAccountSummary(r.Context(), sess.Workspace, sess.Subject)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "profile": summary})
}
func (s *Server) handlePortalAliases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	items, err := s.listDestinationAliases(r.Context(), sess.Subject)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "items": items})
}
func (s *Server) handlePortalPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	hash, active, found, err := s.mailboxLookup(r.Context(), sess.Subject)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	if !found || !active || s.verifyHash(r.Context(), hash, req.CurrentPassword) != nil {
		writeErr(w, 401, "AUTH_FAILED", "Current password is incorrect")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, 400, "BAD_REQUEST", "New password must be at least 8 characters")
		return
	}
	if req.NewPassword == req.CurrentPassword {
		writeErr(w, 400, "BAD_REQUEST", "New password must be different from the current password")
		return
	}
	if err := s.updateMailboxPassword(r.Context(), sess.Subject, req.NewPassword); err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	s.revokeWebmailAccountsForMailbox(r.Context(), sess.Subject)
	if strings.TrimSpace(sess.SessionID) != "" {
		s.clearWebmailSessionAccounts(r.Context(), sess.SessionID)
	}
	s.audit(r.Context(), "mailbox", sess.Subject, "portal.change_password", sess.Subject, `{}`)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) ensurePortalSessionID(w http.ResponseWriter, sess *Session) error {
	if sess == nil {
		return fmt.Errorf("missing session")
	}
	if strings.TrimSpace(sess.SessionID) != "" {
		return nil
	}
	sid, err := randomTokenHex(16)
	if err != nil {
		return err
	}
	sess.SessionID = sid
	return s.setCookie(w, s.cfg.PortalCookieName, *sess)
}

func (s *Server) handleMailAuthLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	var req struct{ Email, Password string }
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if !emailRe.MatchString(req.Email) {
		writeErr(w, 400, "BAD_REQUEST", "Invalid email")
		return
	}
	if strings.TrimSpace(req.Password) == "" {
		writeErr(w, 400, "BAD_REQUEST", "Password is required")
		return
	}
	loginKey := "mail_login_limit|" + s.clientIP(r) + "|" + req.Email
	if err := s.checkLoginRateLimit(loginKey); err != nil {
		writeErr(w, 429, "RATE_LIMITED", err.Error())
		return
	}
	workspaceSlug := strings.TrimSpace(r.Header.Get("X-Workspace-Slug"))
	if workspaceSlug == "" {
		workspaceSlug = "default"
	}
	if ok, err := s.mailboxInWorkspace(r.Context(), workspaceSlug, req.Email); err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	} else if !ok {
		writeErr(w, 403, "FORBIDDEN", "Mailbox is not in this workspace")
		return
	}
	hash, active, found, err := s.mailboxLookup(r.Context(), req.Email)
	if err != nil {
		writeErr(w, 500, "DB_ERROR", err.Error())
		return
	}
	if !found || !active || s.verifyHash(r.Context(), hash, req.Password) != nil {
		s.registerLoginFailure(loginKey)
		writeErr(w, 401, "AUTH_FAILED", "Invalid credentials")
		return
	}
	s.clearLoginFailure(loginKey)
	sid, err := randomTokenHex(16)
	if err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	sess := Session{Subject: req.Email, Kind: "portal", Workspace: workspaceSlug, SessionID: sid, Exp: time.Now().Add(time.Duration(s.cfg.SessionTTLSeconds) * time.Second).Unix()}
	s.clearWebmailSessionAccounts(r.Context(), sid)
	account, err := s.createWebmailAccount(r.Context(), &sess, req.Email, req.Password, hash)
	if err != nil {
		s.clearWebmailSessionAccounts(r.Context(), sid)
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	if err := s.setCookie(w, s.cfg.PortalCookieName, sess); err != nil {
		s.clearWebmailSessionAccounts(r.Context(), sid)
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	_, _ = s.setCSRFCookie(w, "portal")
	writeJSON(w, 200, map[string]any{
		"ok": true,
		"session": map[string]any{
			"primary_email": sess.Subject,
			"workspace":     sess.Workspace,
			"session_id":    sess.SessionID,
		},
		"accounts": []any{s.sanitizeWebmailAccount(account)},
	})
}

func (s *Server) handleMailAuthSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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
	accounts, err := s.listWebmailAccounts(r.Context(), sess.SessionID)
	if err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	items := make([]any, 0, len(accounts))
	for _, account := range accounts {
		state, err := s.validateWebmailAccountState(r.Context(), sess, account)
		if err != nil {
			writeErr(w, 503, "MAILBOX_LOOKUP_UNAVAILABLE", "Mailbox state temporarily unavailable, please retry")
			return
		}
		if state == webmailAccountInvalid {
			continue
		}
		items = append(items, s.sanitizeWebmailAccount(account))
	}
	writeJSON(w, 200, map[string]any{"ok": true, "session": map[string]any{"primary_email": sess.Subject, "workspace": sess.Workspace, "session_id": sess.SessionID}, "accounts": items})
}

func (s *Server) handleMailAccounts(w http.ResponseWriter, r *http.Request) {
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	if err := s.ensurePortalSessionID(w, sess); err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	switch r.Method {
	case http.MethodGet:
		accounts, err := s.listWebmailAccounts(r.Context(), sess.SessionID)
		if err != nil {
			writeErr(w, 500, "INTERNAL_ERROR", err.Error())
			return
		}
		items := make([]any, 0, len(accounts))
		for _, account := range accounts {
			state, err := s.validateWebmailAccountState(r.Context(), sess, account)
			if err != nil {
				writeErr(w, 503, "MAILBOX_LOOKUP_UNAVAILABLE", "Mailbox state temporarily unavailable, please retry")
				return
			}
			if state == webmailAccountInvalid {
				continue
			}
			items = append(items, s.sanitizeWebmailAccount(account))
		}
		writeJSON(w, 200, map[string]any{"ok": true, "items": items})
	case http.MethodPost:
		var req struct{ Email, Password string }
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		req.Email = strings.ToLower(strings.TrimSpace(req.Email))
		if !emailRe.MatchString(req.Email) {
			writeErr(w, 400, "BAD_REQUEST", "Invalid email")
			return
		}
		if strings.TrimSpace(req.Password) == "" {
			writeErr(w, 400, "BAD_REQUEST", "Password is required")
			return
		}
		accounts, err := s.listWebmailAccounts(r.Context(), sess.SessionID)
		if err != nil {
			writeErr(w, 500, "INTERNAL_ERROR", err.Error())
			return
		}
		activeAccounts := make([]WebmailAccount, 0, len(accounts))
		for _, account := range accounts {
			state, err := s.validateWebmailAccountState(r.Context(), sess, account)
			if err != nil {
				writeErr(w, 503, "MAILBOX_LOOKUP_UNAVAILABLE", "Mailbox state temporarily unavailable, please retry")
				return
			}
			if state == webmailAccountInvalid {
				continue
			}
			activeAccounts = append(activeAccounts, account)
		}
		for _, item := range activeAccounts {
			if strings.EqualFold(item.Email, req.Email) {
				writeErr(w, 400, "BAD_REQUEST", "mailbox already connected")
				return
			}
		}
		connectKey := "mail_account_connect_limit|" + s.clientIP(r) + "|" + req.Email
		if err := s.checkLoginRateLimit(connectKey); err != nil {
			writeErr(w, 429, "RATE_LIMITED", err.Error())
			return
		}
		hash, active, found, err := s.mailboxLookup(r.Context(), req.Email)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		if !found || !active || s.verifyHash(r.Context(), hash, req.Password) != nil {
			s.registerLoginFailure(connectKey)
			writeErr(w, 401, "AUTH_FAILED", "Invalid credentials")
			return
		}
		s.clearLoginFailure(connectKey)
		if ok, err := s.mailboxInWorkspace(r.Context(), sess.Workspace, req.Email); err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		} else if !ok {
			writeErr(w, 403, "FORBIDDEN", "Mailbox is not in this workspace")
			return
		}
		account, err := s.createWebmailAccount(r.Context(), sess, req.Email, req.Password, hash)
		if err != nil {
			if errors.Is(err, errWebmailAccountAlreadyConnected) {
				writeErr(w, 400, "BAD_REQUEST", "mailbox already connected")
				return
			}
			if errors.Is(err, errWebmailAccountLimitReached) {
				writeErr(w, 400, "BAD_REQUEST", "max connected mailbox limit reached")
				return
			}
			writeErr(w, 500, "INTERNAL_ERROR", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "account": s.sanitizeWebmailAccount(account)})
	default:
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
	}
}

func (s *Server) handleMailAccountItem(w http.ResponseWriter, r *http.Request) {
	sess := s.requirePortal(w, r)
	if sess == nil {
		return
	}
	if err := s.ensurePortalSessionID(w, sess); err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	pathSuffix := strings.TrimPrefix(r.URL.EscapedPath(), "/api/v1/mail/accounts/")
	parts := strings.Split(pathSuffix, "/")
	for i := range parts {
		decoded, err := url.PathUnescape(parts[i])
		if err != nil {
			writeErr(w, 400, "BAD_REQUEST", "invalid path")
			return
		}
		parts[i] = decoded
	}
	if len(parts) < 1 || strings.TrimSpace(parts[0]) == "" {
		writeErr(w, 400, "BAD_REQUEST", "missing account id")
		return
	}
	accountID := strings.TrimSpace(parts[0])
	if len(parts) == 1 && r.Method == http.MethodDelete {
		s.removeWebmailAccount(r.Context(), sess.SessionID, accountID)
		accounts, _ := s.listWebmailAccounts(r.Context(), sess.SessionID)
		if len(accounts) == 0 {
			s.clearCookie(w, s.cfg.PortalCookieName)
			s.clearCSRFCookie(w, "portal")
		}
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if len(parts) == 2 && parts[1] == "password" && r.Method == http.MethodPost {
		writeErr(w, 501, "NOT_IMPLEMENTED", "use mailbox settings endpoint")
		return
	}
	if len(parts) == 5 && parts[1] == "folders" && parts[3] == "messages" && r.Method == http.MethodGet {
		folder, err := normalizeIMAPFolder(parts[2])
		if err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		uid := strings.TrimSpace(parts[4])
		if folder == "" || uid == "" {
			writeErr(w, 400, "BAD_REQUEST", "invalid message reference")
			return
		}
		if _, err := strconv.Atoi(uid); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "invalid message reference")
			return
		}
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
		msg, err := s.portalMessage(r.Context(), account.Email, password, folder, uid)
		if err != nil {
			if err.Error() == "message not found" {
				writeErr(w, 404, "NOT_FOUND", "message not found")
				return
			}
			if errors.Is(err, errLiteralTooLarge) || errors.Is(err, errTextBodyTooLarge) {
				writeErr(w, 413, "MESSAGE_TOO_LARGE", "message too large")
				return
			}
			writeErr(w, 502, "MAIL_BACKEND_ERROR", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "item": map[string]any{
			"account_id":    account.AccountID,
			"account_email": account.Email,
			"folder":        folder,
			"uid":           msg["uid"],
			"subject":       msg["subject"],
			"from":          msg["from"],
			"to":            msg["to"],
			"date":          msg["date"],
			"text":          msg["text"],
			"html":          msg["html"],
			"attachments":   msg["attachments"],
		}})
		return
	}
	writeErr(w, 404, "NOT_FOUND", "Route not found")
}

func (s *Server) handleMailInbox(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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
	limit := s.cfg.WebmailInboxLimitDefault
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	limit = min(max(1, limit), max(1, s.cfg.WebmailInboxLimitMax))
	accountParam := strings.TrimSpace(r.URL.Query().Get("account"))
	if accountParam == "" {
		accountParam = "all"
	}
	accounts, err := s.listWebmailAccounts(r.Context(), sess.SessionID)
	if err != nil {
		writeErr(w, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	targets := []WebmailAccount{}
	accountPasswords := map[string]string{}
	accountErrors := []map[string]any{}
	if accountParam == "all" {
		for _, account := range accounts {
			resolved, password, err := s.resolveWebmailAccount(r.Context(), sess, account.AccountID)
			if err != nil {
				accountErrors = append(accountErrors, map[string]any{
					"account_id": account.AccountID,
					"email":      account.Email,
					"error":      err.Error(),
				})
				if err.Error() != "account not found" && err.Error() != "mailbox session invalid" {
					writeErr(w, 500, "DB_ERROR", err.Error())
					return
				}
				continue
			}
			targets = append(targets, resolved)
			accountPasswords[resolved.AccountID] = password
		}
		if len(targets) == 0 {
			writeJSON(w, 200, map[string]any{"ok": true, "items": []InboxItem{}, "account_errors": accountErrors})
			return
		}
	} else {
		resolved, password, err := s.resolveWebmailAccount(r.Context(), sess, accountParam)
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
		targets = append(targets, resolved)
		accountPasswords[resolved.AccountID] = password
	}
	type inboxResult struct {
		Account WebmailAccount
		Items   []InboxItem
		Err     error
	}
	results := make(chan inboxResult, len(targets))
	sem := make(chan struct{}, max(1, s.cfg.WebmailAllInboxConcurrency))
	var wg sync.WaitGroup
	for _, account := range targets {
		wg.Add(1)
		go func(acc WebmailAccount) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			items, err := s.inboxForAccount(r.Context(), acc, accountPasswords[acc.AccountID], limit)
			results <- inboxResult{Account: acc, Items: items, Err: err}
		}(account)
	}
	wg.Wait()
	close(results)
	merged := []InboxItem{}
	for result := range results {
		if result.Err != nil {
			accountErrors = append(accountErrors, map[string]any{"account_id": result.Account.AccountID, "email": result.Account.Email, "error": result.Err.Error()})
			continue
		}
		merged = append(merged, result.Items...)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].InternalDate > merged[j].InternalDate
	})
	if len(merged) > limit {
		merged = merged[:limit]
	}
	writeJSON(w, 200, map[string]any{"ok": true, "items": merged, "account_errors": accountErrors})
}

func (s *Server) handleMailSend(w http.ResponseWriter, r *http.Request) {
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
	var req struct {
		AccountID string `json:"account_id"`
		To        string `json:"to"`
		Subject   string `json:"subject"`
		Body      string `json:"body"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	sendKey := "mail_send_limit|" + s.clientIP(r) + "|" + sess.Subject
	if err := s.checkLoginRateLimit(sendKey); err != nil {
		writeErr(w, 429, "RATE_LIMITED", err.Error())
		return
	}
	account, password, err := s.resolveWebmailAccount(r.Context(), sess, req.AccountID)
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
	if err := s.portalSendMail(r.Context(), account.Email, password, req.To, req.Subject, req.Body); err != nil {
		s.registerLoginFailure(sendKey)
		writeErr(w, 502, "MAIL_BACKEND_ERROR", err.Error())
		return
	}
	s.clearLoginFailure(sendKey)
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) routeTenants(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/v1/tenants" {
		if r.Method != http.MethodGet {
			writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		rows, err := s.listWorkspaceRows(r.Context(), true)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"items": rows})
		return
	}
	slug, section, action, ok := tenantParts(r.URL.Path)
	if !ok || section != "mail" {
		writeErr(w, 404, "NOT_FOUND", "Route not found")
		return
	}
	if slug == "self" {
		if sess, err := s.getSession(r, s.cfg.PortalCookieName, "portal"); err == nil && sess.Workspace != "" {
			slug = sess.Workspace
		} else {
			slug = "default"
		}
	}
	r.Header.Set("X-Workspace-Slug", slug)
	switch action {
	case "auth/login":
		s.handlePortalLogin(w, r)
	case "auth/logout":
		s.handlePortalLogout(w, r)
	case "auth/session":
		s.handlePortalSession(w, r)
	case "account/profile":
		s.handlePortalProfile(w, r)
	case "account/aliases":
		s.handlePortalAliases(w, r)
	case "account/password":
		s.handlePortalPassword(w, r)
	default:
		writeErr(w, 404, "NOT_FOUND", "Route not found")
	}
}
func (s *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	switch r.Method {
	case http.MethodGet:
		rows, err := s.listWorkspaceRows(r.Context(), false)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		if !s.isSuperadmin(sess) {
			allowed, err := s.allowedWorkspaceSlugs(r.Context(), sess)
			if err != nil {
				writeErr(w, 500, "DB_ERROR", err.Error())
				return
			}
			allowSet := map[string]bool{}
			for _, slug := range allowed {
				allowSet[slug] = true
			}
			filtered := []WorkspaceRow{}
			for _, row := range rows {
				if allowSet[row.Slug] {
					filtered = append(filtered, row)
				}
			}
			rows = filtered
		}
		writeJSON(w, 200, map[string]any{"items": rows})
	case http.MethodPost:
		if !s.ensureSuperadmin(w, sess) {
			return
		}
		var req struct {
			Slug          string `json:"slug"`
			Name          string `json:"name"`
			DefaultDomain string `json:"default_domain"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if err := s.createWorkspace(r.Context(), req.Slug, req.Name, req.DefaultDomain); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		s.audit(r.Context(), "admin", sess.Subject, "workspace.upsert", req.Slug, `{}`)
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
	}
}
func (s *Server) handleWorkspaceItem(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	parts := strings.Split(trimPrefix(r.URL.Path, "/api/v1/platform/workspaces/"), "/")
	if len(parts) < 2 || parts[0] == "" {
		writeErr(w, 404, "NOT_FOUND", "Route not found")
		return
	}
	slug := parts[0]
	switch {
	case len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodPatch:
		if !s.ensureSuperadmin(w, sess) {
			return
		}
		var req struct {
			Active bool `json:"active"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if err := s.setWorkspaceActive(r.Context(), slug, req.Active); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case len(parts) == 2 && parts[1] == "domains" && r.Method == http.MethodGet:
		if !s.ensureWorkspaceAccess(w, r, sess, slug) {
			return
		}
		items, err := s.listWorkspaceDomains(r.Context(), slug)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case len(parts) == 2 && parts[1] == "domains" && r.Method == http.MethodPost:
		if !s.ensureSuperadmin(w, sess) {
			return
		}
		var req struct {
			Domain string `json:"domain"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if err := s.attachDomainToWorkspace(r.Context(), slug, req.Domain); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 404, "NOT_FOUND", "Route not found")
	}
}
func (s *Server) listAdminUsers(ctx context.Context) ([]AdminUserRow, error) {
	out, err := s.execSQL(ctx, "ro", fmt.Sprintf("SELECT id,username,role,is_active FROM %s ORDER BY username;", s.cfg.AdminTable))
	if err != nil {
		return nil, err
	}
	items := []AdminUserRow{}
	for _, line := range splitLines(out) {
		cols := strings.Split(line, "\t")
		if len(cols) < 4 {
			continue
		}
		id, _ := strconv.ParseInt(cols[0], 10, 64)
		row := AdminUserRow{ID: id, Username: cols[1], Role: cols[2], Active: strings.TrimSpace(cols[3]) == "1"}
		row.Bindings, _ = s.adminWorkspaceBindings(ctx, row.Username)
		for _, b := range row.Bindings {
			row.Workspaces = append(row.Workspaces, b.WorkspaceSlug)
		}
		items = append(items, row)
	}
	return items, nil
}
func (s *Server) upsertAdminUser(ctx context.Context, username, plainPassword, role string, isActive bool) error {
	if !usernameRe.MatchString(username) {
		return fmt.Errorf("invalid username")
	}
	if role == "" {
		role = "workspace_admin"
	}
	if role != "superadmin" && role != "workspace_admin" {
		return fmt.Errorf("invalid role")
	}
	active := 0
	if isActive {
		active = 1
	}
	existing, _, _, _, found, err := s.adminLookup(ctx, username)
	if err != nil {
		return err
	}
	hash := existing
	if strings.TrimSpace(plainPassword) != "" {
		hash, err = s.hashPassword(ctx, plainPassword)
		if err != nil {
			return err
		}
	}
	if !found && hash == "" {
		return fmt.Errorf("password required for new admin user")
	}
	_, err = s.execSQL(ctx, "admin", fmt.Sprintf("INSERT INTO %s(username,password_hash,role,is_active,session_version) VALUES(%s,%s,%s,%d,1) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), is_active=VALUES(is_active), session_version=COALESCE(session_version,1)+1;", s.cfg.AdminTable, s.sqlQuote(username), s.sqlQuote(hash), s.sqlQuote(role), active))
	return err
}
func (s *Server) replaceAdminWorkspaceBindings(ctx context.Context, username string, bindings []BindingPermission) error {
	adminID, err := s.adminIDByUsername(ctx, username)
	if err != nil {
		return err
	}
	if _, err := s.execSQL(ctx, "admin", fmt.Sprintf("DELETE FROM %s WHERE admin_user_id=%d;", s.cfg.AdminWorkspaceBindingTable, adminID)); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, binding := range bindings {
		slug := strings.TrimSpace(binding.WorkspaceSlug)
		if slug == "" || seen[slug] {
			continue
		}
		seen[slug] = true
		row, found, err := s.workspaceExists(ctx, slug)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("workspace not found: %s", slug)
		}
		iv := func(v bool) int {
			if v {
				return 1
			}
			return 0
		}
		q := fmt.Sprintf("INSERT INTO %s(admin_user_id,workspace_id,can_read,can_write,manage_domains,manage_mailboxes,manage_aliases) VALUES(%d,%d,%d,%d,%d,%d,%d) ON DUPLICATE KEY UPDATE can_read=VALUES(can_read), can_write=VALUES(can_write), manage_domains=VALUES(manage_domains), manage_mailboxes=VALUES(manage_mailboxes), manage_aliases=VALUES(manage_aliases);", s.cfg.AdminWorkspaceBindingTable, adminID, row.ID, iv(binding.CanRead), iv(binding.CanWrite), iv(binding.ManageDomains), iv(binding.ManageMailboxes), iv(binding.ManageAliases))
		if _, err := s.execSQL(ctx, "admin", q); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	if !s.ensureSuperadmin(w, sess) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		items, err := s.listAdminUsers(r.Context())
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case http.MethodPost:
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Role     string `json:"role"`
			Active   bool   `json:"active"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if err := s.upsertAdminUser(r.Context(), req.Username, req.Password, req.Role, req.Active); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
	}
}
func (s *Server) handleAdminUserItem(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	if !s.ensureSuperadmin(w, sess) {
		return
	}
	parts := strings.Split(trimPrefix(r.URL.Path, "/api/v1/platform/admin-users/"), "/")
	if len(parts) < 2 || parts[0] == "" {
		writeErr(w, 404, "NOT_FOUND", "Route not found")
		return
	}
	username := parts[0]
	switch {
	case len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodPatch:
		var req struct {
			Active bool `json:"active"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		_, role, _, _, found, err := s.adminLookup(r.Context(), username)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		if !found {
			writeErr(w, 404, "NOT_FOUND", "Admin user not found")
			return
		}
		if err := s.upsertAdminUser(r.Context(), username, "", role, req.Active); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case len(parts) == 2 && parts[1] == "password" && r.Method == http.MethodPost:
		var req struct {
			NewPassword string `json:"new_password"`
		}
		if err := readJSON(r, &req); err != nil || len(req.NewPassword) < 8 {
			writeErr(w, 400, "BAD_REQUEST", "Password must be at least 8 characters")
			return
		}
		_, role, active, _, _, err := s.adminLookup(r.Context(), username)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		if err := s.upsertAdminUser(r.Context(), username, req.NewPassword, role, active); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case len(parts) == 2 && parts[1] == "workspaces" && r.Method == http.MethodGet:
		items, err := s.adminWorkspaceBindings(r.Context(), username)
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	case len(parts) == 2 && parts[1] == "workspaces" && (r.Method == http.MethodPut || r.Method == http.MethodPost):
		var req struct {
			Workspaces []string            `json:"workspaces"`
			Bindings   []BindingPermission `json:"bindings"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		bindings := req.Bindings
		if len(bindings) == 0 {
			for _, slug := range req.Workspaces {
				bindings = append(bindings, BindingPermission{WorkspaceSlug: slug, CanRead: true, CanWrite: true, ManageDomains: true, ManageMailboxes: true, ManageAliases: true})
			}
		}
		if err := s.replaceAdminWorkspaceBindings(r.Context(), username, bindings); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 404, "NOT_FOUND", "Route not found")
	}
}
func (s *Server) handleDomains(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	switch r.Method {
	case http.MethodGet:
		rows, err := s.listDomains(r.Context())
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		requestedWS := strings.TrimSpace(r.URL.Query().Get("workspace"))
		if !s.isSuperadmin(sess) || requestedWS != "" {
			allowSet, err := s.allowedDomainSet(r.Context(), sess, requestedWS)
			if err != nil {
				if err.Error() == "forbidden workspace" {
					writeErr(w, 403, "FORBIDDEN", "Not allowed to access this workspace")
				} else {
					writeErr(w, 500, "DB_ERROR", err.Error())
				}
				return
			}
			filtered := []DomainRow{}
			for _, row := range rows {
				if allowSet[row.Name] {
					filtered = append(filtered, row)
				}
			}
			rows = filtered
		}
		writeJSON(w, 200, map[string]any{"items": rows})
	case http.MethodPost:
		var req struct {
			Domain        string `json:"domain"`
			WorkspaceSlug string `json:"workspace_slug"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if !domainRe.MatchString(req.Domain) {
			writeErr(w, 400, "BAD_REQUEST", "Invalid domain")
			return
		}
		if !s.isSuperadmin(sess) {
			if req.WorkspaceSlug == "" {
				writeErr(w, 400, "BAD_REQUEST", "workspace_slug is required")
				return
			}
			if !s.ensureWorkspaceAccess(w, r, sess, req.WorkspaceSlug) {
				return
			}
			perm, _, err := s.adminWorkspacePermission(r.Context(), sess.Subject, req.WorkspaceSlug)
			if err != nil {
				writeErr(w, 500, "DB_ERROR", err.Error())
				return
			}
			if !perm.allows("domain", true) {
				writeErr(w, 403, "FORBIDDEN", "Permission denied for domain management")
				return
			}
		}
		if err := s.addDomain(r.Context(), req.Domain); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		if req.WorkspaceSlug != "" {
			if err := s.attachDomainToWorkspace(r.Context(), req.WorkspaceSlug, req.Domain); err != nil {
				writeErr(w, 400, "BAD_REQUEST", err.Error())
				return
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "domain": req.Domain})
	default:
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
	}
}
func (s *Server) handleDomainItem(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	parts := strings.Split(trimAnyPrefix(r.URL.Path, "/api/v1/admin/domains/", "/api/v1/platform/mail/domains/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] != "status" {
		writeErr(w, 404, "NOT_FOUND", "Route not found")
		return
	}
	var req struct {
		Active bool `json:"active"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	if !s.isSuperadmin(sess) {
		if !s.requireResourcePermission(w, r, sess, "domain", parts[0], true) {
			return
		}
	}
	if err := s.setDomainActive(r.Context(), parts[0], req.Active); err != nil {
		writeErr(w, 400, "BAD_REQUEST", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) handleMailboxes(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	switch r.Method {
	case http.MethodGet:
		rows, err := s.listMailboxes(r.Context())
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		requestedWS := strings.TrimSpace(r.URL.Query().Get("workspace"))
		if !s.isSuperadmin(sess) || requestedWS != "" {
			allowSet, err := s.allowedDomainSet(r.Context(), sess, requestedWS)
			if err != nil {
				if err.Error() == "forbidden workspace" {
					writeErr(w, 403, "FORBIDDEN", "Not allowed to access this workspace")
				} else {
					writeErr(w, 500, "DB_ERROR", err.Error())
				}
				return
			}
			filtered := []MailboxRow{}
			for _, row := range rows {
				if d, _ := domainFromEmail(row.Email); allowSet[d] {
					filtered = append(filtered, row)
				}
			}
			rows = filtered
		}
		writeJSON(w, 200, map[string]any{"items": rows})
	case http.MethodPost:
		var req struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if !s.isSuperadmin(sess) {
			domain, err := domainFromEmail(req.Email)
			if err != nil {
				writeErr(w, 400, "BAD_REQUEST", err.Error())
				return
			}
			if !s.requireResourcePermission(w, r, sess, "mailbox", domain, true) {
				return
			}
		}
		email, err := s.addMailbox(r.Context(), req.Email, req.Password)
		if err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "email": email})
	default:
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
	}
}
func (s *Server) handleMailboxItem(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	parts := strings.Split(trimAnyPrefix(r.URL.Path, "/api/v1/admin/mailboxes/", "/api/v1/platform/mail/mailboxes/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeErr(w, 404, "NOT_FOUND", "Route not found")
		return
	}
	email := parts[0]
	if !s.isSuperadmin(sess) {
		domain, err := domainFromEmail(email)
		if err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		if !s.requireResourcePermission(w, r, sess, "mailbox", domain, true) {
			return
		}
	}
	switch {
	case len(parts) == 1 && r.Method == http.MethodDelete:
		s.revokeWebmailAccountsForMailbox(r.Context(), email)
		if err := s.deleteMailbox(r.Context(), email); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodPatch:
		var req struct {
			Active bool `json:"active"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if err := s.setMailboxActive(r.Context(), email, req.Active); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		if !req.Active {
			s.revokeWebmailAccountsForMailbox(r.Context(), email)
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case len(parts) == 2 && parts[1] == "password" && r.Method == http.MethodPost:
		var req struct {
			NewPassword string `json:"new_password"`
		}
		if err := readJSON(r, &req); err != nil || len(req.NewPassword) < 8 {
			writeErr(w, 400, "BAD_REQUEST", "Password must be at least 8 characters")
			return
		}
		if err := s.updateMailboxPassword(r.Context(), email, req.NewPassword); err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		s.revokeWebmailAccountsForMailbox(r.Context(), email)
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 404, "NOT_FOUND", "Route not found")
	}
}
func (s *Server) handleAliases(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	switch r.Method {
	case http.MethodGet:
		rows, err := s.listAliases(r.Context())
		if err != nil {
			writeErr(w, 500, "DB_ERROR", err.Error())
			return
		}
		requestedWS := strings.TrimSpace(r.URL.Query().Get("workspace"))
		if !s.isSuperadmin(sess) || requestedWS != "" {
			allowSet, err := s.allowedDomainSet(r.Context(), sess, requestedWS)
			if err != nil {
				if err.Error() == "forbidden workspace" {
					writeErr(w, 403, "FORBIDDEN", "Not allowed to access this workspace")
				} else {
					writeErr(w, 500, "DB_ERROR", err.Error())
				}
				return
			}
			filtered := []AliasRow{}
			for _, row := range rows {
				if d, _ := domainFromEmail(row.Source); allowSet[d] {
					filtered = append(filtered, row)
				}
			}
			rows = filtered
		}
		writeJSON(w, 200, map[string]any{"items": rows})
	case http.MethodPost:
		var req struct {
			Source      string `json:"source"`
			Destination string `json:"destination"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if !s.isSuperadmin(sess) {
			d, err := domainFromEmail(req.Source)
			if err != nil {
				writeErr(w, 400, "BAD_REQUEST", err.Error())
				return
			}
			if !s.requireResourcePermission(w, r, sess, "alias", d, true) {
				return
			}
		}
		if err := s.upsertAlias(r.Context(), req.Source, req.Destination); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
	}
}
func (s *Server) handleAliasItem(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	parts := strings.Split(trimAnyPrefix(r.URL.Path, "/api/v1/admin/aliases/", "/api/v1/platform/mail/aliases/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeErr(w, 404, "NOT_FOUND", "Route not found")
		return
	}
	source := parts[0]
	if !s.isSuperadmin(sess) {
		d, err := domainFromEmail(source)
		if err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		if !s.requireResourcePermission(w, r, sess, "alias", d, true) {
			return
		}
	}
	switch {
	case len(parts) == 1 && r.Method == http.MethodDelete:
		if err := s.deleteAlias(r.Context(), source); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	case len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodPatch:
		var req struct {
			Active bool `json:"active"`
		}
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
			return
		}
		if err := s.setAliasActive(r.Context(), source, req.Active); err != nil {
			writeErr(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeErr(w, 404, "NOT_FOUND", "Route not found")
	}
}
func (s *Server) handleSystemAliases(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	var req struct {
		Domain string `json:"domain"`
		Target string `json:"target_email"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "BAD_REQUEST", "Invalid JSON body")
		return
	}
	if !s.isSuperadmin(sess) {
		if !s.requireResourcePermission(w, r, sess, "alias", req.Domain, true) {
			return
		}
	}
	if err := s.ensureSystemAliases(r.Context(), req.Domain, req.Target); err != nil {
		writeErr(w, 400, "BAD_REQUEST", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
func (s *Server) readMaps() ([]map[string]any, error) {
	pattern := filepath.Join(s.cfg.PostfixCfg, "mysql", "*.cf")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	items := []map[string]any{}
	required := []string{"user", "password", "hosts", "dbname", "query"}
	for _, f := range files {
		entry := map[string]any{"path": f, "exists": true, "parse_ok": true}
		b, readErr := os.ReadFile(f)
		if readErr != nil {
			entry["parse_ok"] = false
			entry["error"] = readErr.Error()
			items = append(items, entry)
			continue
		}
		cfgMap := map[string]string{}
		for _, ln := range splitLines(string(b)) {
			kv := strings.SplitN(ln, "=", 2)
			if len(kv) != 2 {
				continue
			}
			cfgMap[strings.TrimSpace(strings.ToLower(kv[0]))] = strings.TrimSpace(kv[1])
		}
		missing := []string{}
		for _, k := range required {
			if strings.TrimSpace(cfgMap[k]) == "" {
				missing = append(missing, k)
			}
		}
		entry["required_complete"] = len(missing) == 0
		entry["missing_required"] = missing
		items = append(items, entry)
	}
	return items, nil
}
func (s *Server) handleMaps(w http.ResponseWriter, r *http.Request) {
	sess := s.requireAdmin(w, r)
	if sess == nil {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	if !s.ensureSuperadmin(w, sess) {
		return
	}
	items, err := s.readMaps()
	if err != nil {
		writeErr(w, 500, "READ_ERROR", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/healthz/live", s.handleHealth)
	mux.HandleFunc("/healthz/ready", s.handleHealthReady)
	mux.HandleFunc("/internal/healthz", s.handleHealthReady)
	mux.HandleFunc("/api/v1/platform/auth/login", s.handleAdminLogin)
	mux.HandleFunc("/api/v1/platform/auth/logout", s.handleAdminLogout)
	mux.HandleFunc("/api/v1/platform/auth/session", s.handleAdminSession)
	mux.HandleFunc("/api/v1/platform/workspaces", s.handleWorkspaces)
	mux.HandleFunc("/api/v1/platform/workspaces/", s.handleWorkspaceItem)
	mux.HandleFunc("/api/v1/platform/admin-users", s.handleAdminUsers)
	mux.HandleFunc("/api/v1/platform/admin-users/", s.handleAdminUserItem)
	mux.HandleFunc("/api/v1/platform/mail/domains", s.handleDomains)
	mux.HandleFunc("/api/v1/platform/mail/domains/", s.handleDomainItem)
	mux.HandleFunc("/api/v1/platform/mail/mailboxes", s.handleMailboxes)
	mux.HandleFunc("/api/v1/platform/mail/mailboxes/", s.handleMailboxItem)
	mux.HandleFunc("/api/v1/platform/mail/aliases", s.handleAliases)
	mux.HandleFunc("/api/v1/platform/mail/aliases/", s.handleAliasItem)
	mux.HandleFunc("/api/v1/platform/mail/system-aliases", s.handleSystemAliases)
	mux.HandleFunc("/api/v1/platform/mail/health/maps", s.handleMaps)
	mux.HandleFunc("/api/v1/tenants", s.routeTenants)
	mux.HandleFunc("/api/v1/tenants/", s.routeTenants)
	mux.HandleFunc("/api/v1/mail/auth/login", s.handleMailAuthLogin)
	mux.HandleFunc("/api/v1/mail/auth/session", s.handleMailAuthSession)
	mux.HandleFunc("/api/v1/mail/auth/logout", s.handlePortalLogout)
	mux.HandleFunc("/api/v1/mail/accounts", s.handleMailAccounts)
	mux.HandleFunc("/api/v1/mail/accounts/", s.handleMailAccountItem)
	mux.HandleFunc("/api/v1/mail/inbox", s.handleMailInbox)
	mux.HandleFunc("/api/v1/mail/send", s.handleMailSend)
	return mux
}

func main() {
	logger := log.New(os.Stdout, "[mailadmin] ", log.LstdFlags|log.LUTC)
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatal(err)
	}
	encKey := sha256.Sum256([]byte(cfg.WebmailAccountEncKey))
	srv := &Server{cfg: cfg, logger: logger, loginAttempts: map[string]loginAttempt{}, webmailEncKey: encKey}
	if err := srv.ensureMetaTables(context.Background()); err != nil {
		logger.Fatalf("ensure meta tables failed: %v", err)
	}
	startupCtx, startupCancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer startupCancel()
	if err := srv.checkMySQLReady(startupCtx); err != nil {
		logger.Fatalf("startup dependency check failed: mysql not ready: %v", err)
	}
	if err := srv.checkRedisReady(startupCtx); err != nil {
		logger.Fatalf("startup dependency check failed: redis not ready: %v", err)
	}
	logger.Printf("redis backend: network=%s addr=%s db=%d", cfg.RedisNetwork, cfg.RedisAddr, cfg.RedisDB)
	httpServer := &http.Server{
		Addr:              cfg.AppAddr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		logger.Printf("listening on %s", cfg.AppAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("listen failed: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
