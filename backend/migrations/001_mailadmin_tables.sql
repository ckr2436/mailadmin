-- MailOps control-plane metadata tables.
CREATE TABLE IF NOT EXISTS app_admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('superadmin','workspace_admin') NOT NULL DEFAULT 'workspace_admin',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_admin_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_workspaces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  default_domain VARCHAR(255) DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_workspaces_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_workspace_domains (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_slug VARCHAR(64) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_workspace_domains (workspace_slug, domain),
  KEY idx_app_workspace_domains_domain (domain),
  CONSTRAINT fk_app_workspace_domains_workspace
    FOREIGN KEY (workspace_slug) REFERENCES app_workspaces(slug)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_admin_workspace_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(128) NOT NULL,
  workspace_slug VARCHAR(64) NOT NULL,
  can_read TINYINT(1) NOT NULL DEFAULT 1,
  can_write TINYINT(1) NOT NULL DEFAULT 0,
  manage_domains TINYINT(1) NOT NULL DEFAULT 0,
  manage_mailboxes TINYINT(1) NOT NULL DEFAULT 0,
  manage_aliases TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_admin_workspace_bindings (username, workspace_slug),
  KEY idx_app_admin_workspace_bindings_workspace (workspace_slug),
  CONSTRAINT fk_app_admin_workspace_bindings_admin
    FOREIGN KEY (username) REFERENCES app_admin_users(username)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_app_admin_workspace_bindings_workspace
    FOREIGN KEY (workspace_slug) REFERENCES app_workspaces(slug)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type ENUM('admin','portal') NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  workspace_slug VARCHAR(64) DEFAULT NULL,
  action VARCHAR(128) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(255) DEFAULT NULL,
  details_json LONGTEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_app_audit_logs_created_at (created_at),
  KEY idx_app_audit_logs_workspace_slug (workspace_slug),
  KEY idx_app_audit_logs_actor (actor_type, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
