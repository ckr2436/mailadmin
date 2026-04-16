# MailOps for `mail.myupona.com`

这是一个按 **backend / frontend / deploy** 分层组织的 Go 版邮箱控制台，适配你现有的：

- Postfix + Dovecot
- MySQL 虚拟邮箱表：`virtual_domains / virtual_users / virtual_aliases`
- 运行账号与管理账号分离：
  - `mailro`：Postfix / Dovecot 只读查询
  - `mailadmin`：控制台读写管理

底层邮箱数据和密码哈希策略参考你现有脚本的做法，继续围绕 MySQL 虚拟域/用户/别名表工作，并沿用 Dovecot `SHA512-CRYPT` 方案。fileciteturn28file0

## 目录

```text
backend/
  cmd/server/main.go
  bin/mailadmin-api
  migrations/001_mailadmin_tables.sql.disabled
  scripts/init_admin.sh
  .env
frontend/
  dist/         # 直接部署的静态文件
  src/          # React/Vite 源码基线
deploy/
  nginx/mail.myupona.com.conf
  systemd/mailadmin.service
  systemd/mailadmin.env
  scripts/install.sh
```

## 当前环境参数（已写入）

```env
DB_SOCKET=/var/lib/mysql/mysql.sock
DB_NAME=mailserver

DB_RO_USER=mailro
DB_RO_PASS=replace-with-db-readonly-password

DB_ADMIN_USER=mailadmin
DB_ADMIN_PASS=replace-with-db-admin-password

DEFAULT_DOMAIN=myupona.com
MAIL_HOST=mail.myupona.com
```

## 权限模型

### 1. 管理员角色
- `superadmin`
  - 可管理全部 workspace
  - 可创建 / 启停 workspace
  - 可管理管理员账号与绑定
- `workspace_admin`
  - 仅能查看和操作绑定给自己的 workspace

### 2. Workspace 绑定权限
`app_admin_workspace_bindings` 表提供细粒度控制：

- `can_read`
- `can_write`
- `manage_domains`
- `manage_mailboxes`
- `manage_aliases`

## 主要接口

### 平台端
- `POST /api/v1/platform/auth/login`
- `GET /api/v1/platform/auth/session`
- `GET|POST /api/v1/platform/workspaces`
- `PATCH /api/v1/platform/workspaces/{slug}/status`
- `GET|POST /api/v1/platform/admin-users`
- `PATCH /api/v1/platform/admin-users/{username}/status`
- `POST /api/v1/platform/admin-users/{username}/password`
- `GET|PUT /api/v1/platform/admin-users/{username}/workspaces`
- `GET|POST /api/v1/platform/mail/domains`
- `PATCH /api/v1/platform/mail/domains/{domain}/status`
- `GET|POST /api/v1/platform/mail/mailboxes`
- `DELETE /api/v1/platform/mail/mailboxes/{email}`
- `PATCH /api/v1/platform/mail/mailboxes/{email}/status`
- `POST /api/v1/platform/mail/mailboxes/{email}/password`
- `GET|POST /api/v1/platform/mail/aliases`
- `DELETE /api/v1/platform/mail/aliases/{source}`
- `PATCH /api/v1/platform/mail/aliases/{source}/status`
- `POST /api/v1/platform/mail/system-aliases`
- `GET /api/v1/platform/mail/health/maps`

### 租户端 / 用户前台
- `GET /api/v1/tenants`
- `POST /api/v1/tenants/{workspace}/mail/auth/login`
- `GET /api/v1/tenants/{workspace}/mail/auth/session`
- `GET /api/v1/tenants/{workspace}/mail/account/profile`
- `GET /api/v1/tenants/{workspace}/mail/account/aliases`
- `POST /api/v1/tenants/{workspace}/mail/account/password`

兼容旧入口：
- `/api/v1/admin/*`
- `/api/v1/portal/*`

## 首次部署

### 1. 启动 API（自动初始化元数据表）
```bash
# 启动 API 后会自动 ensureMetaTables() 完成初始化，不再需要手动执行 SQL 迁移
```

### 2. 初始化 superadmin
```bash
cd /opt/apps/mailops/backend
./scripts/init_admin.sh admin ChangeMe123 superadmin
```

### 3. 安装 systemd
```bash
cp /opt/apps/mailops/deploy/systemd/mailadmin.service /etc/systemd/system/mailadmin.service
cp /opt/apps/mailops/deploy/systemd/mailadmin.env /opt/apps/mailops/deploy/systemd/mailadmin.env
systemctl daemon-reload
systemctl enable --now mailadmin
```

### 4. 安装 nginx 站点
把 `deploy/nginx/mail.myupona.com.conf` 放到你的 nginx 站点目录，然后：
- 修改证书路径
- 检查 `root /opt/apps/mailops/frontend/dist;`
- 检查 `proxy_pass http://127.0.0.1:18080;`

## systemd / nginx 说明

### systemd
- 使用 `EnvironmentFile=/opt/apps/mailops/deploy/systemd/mailadmin.env`
- 默认监听：`127.0.0.1:18080`
- 建议用 `chmod 600` 限制 `.env` 与 `mailadmin.env`

### nginx
- `/admin/` → 管理后台静态页
- `/mail/` → 邮箱用户 Webmail 静态页（`/portal/` 会重定向到 `/mail/`）
- `/api/` → 反代 Go API
- `/assets/` → 静态资源缓存 7 天

## 前端说明

- `frontend/dist/`：当前可直接上线使用
- `frontend/src/`：React/Vite 源码基线
- 如果后续你要继续做前端工程化开发，可在 `frontend/` 下执行：
```bash
npm install
npm run build
```

## 生产建议

1. 这套代码是 **生产导向基线**，不是审计完成的商业成品，正式公网暴露前建议再做一次自测与权限回归。
2. `.env` 和 `deploy/systemd/mailadmin.env` 只能使用占位符或通过安全系统下发的密钥，不要提交真实密码：
```bash
chmod 600 /opt/apps/mailops/backend/.env
chmod 600 /opt/apps/mailops/deploy/systemd/mailadmin.env
```
3. 建议给 nginx 加 Fail2ban / WAF / 访问频率控制。
4. 如果后续你要把 root 运行收紧，可改为单独服务账号，再按需放开：
   - MySQL socket 访问
   - Dovecot `doveadm`
   - Postfix 配置目录读取

## 默认入口

- 管理后台：`https://mail.myupona.com/admin/`
- 用户前台：`https://mail.myupona.com/`（登录后进入 `https://mail.myupona.com/mail/`）
