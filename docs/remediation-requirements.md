# MailAdmin 修复要求（按优先级执行）

本文档基于当前仓库代码与配置审查结果整理，目标是给开发直接执行修复。

---

## P0：立即处理（高危）

### 1. 删除仓库中的真实密钥，并立刻轮换

#### 问题
仓库当前提交了真实的数据库密码和 `SESSION_SECRET`，属于已发生的密钥泄露。

#### 涉及文件
- `README.md`
- `backend/.env`
- `deploy/systemd/mailadmin.env`

#### 必须修复
1. 立即轮换以下生产密钥：
   - `DB_RO_PASS`
   - `DB_ADMIN_PASS`
   - `SESSION_SECRET`
2. 从仓库中删除所有真实密钥，改为占位符。
3. 仓库只保留 `.env.example`，不要提交真实 `.env`。
4. README 中不得出现任何真实密码或 secret。
5. 如仓库曾公开或多人访问，评估是否需要清理 git 历史。

#### 验收标准
- 仓库中不存在真实 secret、token、数据库密码。
- 生产环境已完成密钥轮换。
- 新 session secret 生效，旧 secret 失效。

---

### 2. 管理员权限不能只信任 cookie 中的 role

#### 问题
当前管理员登录后，role 被写入签名 cookie。后续权限判断大量依赖 cookie 中的 `Role`，而不是每次请求回库确认当前账号状态。

#### 风险
- 被降权的 superadmin，在旧 session 过期前可能仍保留高权限。
- 被禁用的管理员，旧 cookie 可能仍可继续访问。

#### 必须修复
1. session 中只保留最小身份信息，例如：
   - `sub`
   - `kind`
   - `exp`
2. 每次管理端请求都必须重新查询管理员当前状态：
   - 当前 `role`
   - 当前 `is_active`
3. 所有高权限判断必须基于数据库最新状态，而不是 cookie 中缓存的 role。
4. 管理员被禁用、降权、改密后，应立即使现有 session 失效。
5. 如短期内不做完整服务端 session 存储，也至少增加 session version / user version 校验。

#### 验收标准
- 管理员角色变更后，现有会话立即按新角色生效。
- 管理员禁用后，现有会话立即失效。
- `isSuperadmin` 不再只依赖 cookie 中的 role。

---

### 3. 禁止用 `X-Mail-Password` 在每个请求中传邮箱密码

#### 问题
当前 portal 前端把邮箱密码保存在页面内存中，并通过 `X-Mail-Password` 请求头重复发送到后端，用于收件箱、读信、发信。

#### 风险
- 一旦出现 XSS，邮箱密码会被直接拿走。
- 某些代理、日志、APM 可能记录请求头。
- 用户明文密码在前端停留时间过长。

#### 必须修复
1. 登录后不要再让前端重复发送邮箱密码。
2. 改成以下任一方案：
   - 后端创建短时 webmail session
   - 后端签发短时 access token，并在服务端保存邮箱认证状态
3. inbox / message / send 接口全部改为使用短时 token，不再接受 `X-Mail-Password`。
4. logout、改密后立即清理 webmail session/token。
5. 前端不得长期保存邮箱密码。

#### 验收标准
- 除登录动作外，浏览器后续请求中不再出现邮箱明文密码。
- webmail 功能仍可正常使用。
- 改密或退出后，原 webmail token 失效。

---

## P1：尽快处理（安全与权限）

### 4. 默认不要信任代理头

#### 问题
当前 `APP_TRUST_PROXY` 默认是 `true`，且 `.env` 中也是开启状态。后端会直接信任 `X-Forwarded-For` 和 `X-Real-IP`。

#### 风险
- 请求来源 IP 可被伪造。
- 审计日志不可信。
- 后续按 IP 做限流时容易被绕过。

#### 必须修复
1. 默认值改为 `APP_TRUST_PROXY=false`。
2. 只有在确认服务只能通过受信反向代理访问时才允许开启。
3. 最好增加受信代理 IP 白名单机制。
4. 文档中明确说明代理信任前提。

#### 验收标准
- 默认环境不信任转发头。
- 仅受信代理链路可以影响 client IP。
- 审计日志中的 IP 不能被任意客户端伪造。

---

### 5. `mail/health/maps` 不应向普通管理员暴露内部配置

#### 问题
当前 `/api/v1/platform/mail/health/maps` 只要求 admin 登录，不要求 superadmin。接口会返回 Postfix mysql map 配置内容，只是简单隐藏 password 字段。

#### 风险
- workspace_admin 可看到内部路径、数据库用户名、查询结构、部署信息。
- 泄露不必要的运维细节。

#### 必须修复
1. 此接口至少限制为 superadmin。
2. 更推荐改成只返回摘要状态：
   - 文件存在/不存在
   - 解析是否成功
   - 必填项是否完整
3. 线上环境不要返回原始配置正文。

#### 验收标准
- workspace_admin 无法访问该接口。
- 接口不再返回原始配置内容。
- 健康检查页面只显示必要状态。

---

### 6. 增加登录限流与 CSRF 防护

#### 问题
当前管理员登录、portal 登录以及多个 cookie 鉴权写操作接口，没有明确的限流与 CSRF 机制。

#### 必须修复
1. 对以下接口加限流：
   - `/api/v1/platform/auth/login`
   - `/api/v1/portal/auth/login`
   - `/api/v1/tenants/*/mail/auth/login`
2. 限流至少按以下维度组合：
   - IP
   - 用户名 / 邮箱
3. 连续失败后增加退避或临时锁定。
4. 对所有依赖 cookie 的写操作增加 CSRF token。
5. 对写操作额外校验 `Origin`。

#### 验收标准
- 登录暴力尝试会被限制。
- 无有效 CSRF token 的写请求被拒绝。
- 跨站伪造请求无法成功触发敏感操作。

---

## P2：功能与一致性修复（影响上线稳定性）

### 7. 修复管理员前端字段与后端返回不一致

#### 问题
后端管理员列表返回的是 `workspaces`，前端渲染时却读取 `allowed_workspaces`。

#### 必须修复
1. 统一接口字段名。
2. 前后端保持一致：要么统一为 `workspaces`，要么统一为其他命名。
3. 为管理员列表增加最基本的接口契约校验。

#### 验收标准
- 管理员列表中的 workspace 正确显示。
- 前后端字段名一致。

---

### 8. 修复 portal 页面端口字段不一致

#### 问题
后端返回的是：
- `imap_ssl_port`
- `smtp_tls_port`
- `smtp_ssl_port`

前端显示时却读取：
- `imap_port`
- `smtp_submission_port`

#### 必须修复
1. portal 前端按后端真实字段渲染。
2. 如要改接口字段名，必须同步修改前后端并更新文档。

#### 验收标准
- portal 页面展示的端口来自真实后端字段。
- 不再依赖前端硬编码默认值掩盖问题。

---

### 9. 统一前端构建输出目录与部署目录

#### 问题
当前 `vite.config.js` 输出到 `build/`，但 README、nginx、页面说明使用的是 `dist/`。

#### 必须修复
1. 统一构建输出目录。
2. 推荐统一为 `dist/`，因为当前部署配置和文档都在用它。
3. 同步更新：
   - `vite.config.js`
   - README
   - nginx 文档
   - 安装/部署脚本

#### 验收标准
- `npm run build` 后产物会落到实际部署目录。
- 文档、nginx、代码配置全部一致。

---

### 10. 修复安装脚本引用错误的 SQL 文件

#### 问题
`deploy/scripts/install.sh` 提示执行 `backend/migrations/001_mailadmin_tables.sql`，但仓库实际文件是 `001_mailadmin_tables.sql.disabled`。同时后端启动又会自动 `ensureMetaTables()`，迁移策略混乱。

#### 必须修复
1. 明确只保留一种初始化策略：
   - 显式 migration
   - 启动时 bootstrap
2. 删除无效路径引用。
3. 文档与脚本保持一致。
4. 若保留 migration 文件，文件名与路径必须真实存在。

#### 验收标准
- 安装脚本引用的文件真实存在。
- 文档中的初始化步骤可直接执行。
- 初始化策略清晰且只有一套主路径。

---

### 11. 读信不要使用 IMAP sequence number，改用 UID

#### 问题
当前前后端使用 message sequence number 作为读信标识。IMAP sequence number 不稳定，收件箱变化后可能漂移。

#### 必须修复
1. 前端列表项使用 UID 作为消息标识。
2. 后端查询消息详情改为按 UID 读取。
3. 接口返回中明确区分：
   - UI 展示用字段
   - 稳定的消息 ID

#### 验收标准
- 新邮件到达后，已显示列表的消息标识仍稳定。
- 点击邮件不会读到错误的消息。

---

## P3：建议优化

### 12. 改善错误响应结构，前端避免显示 `[object Object]`

#### 问题
后端错误结构是嵌套对象，但前端错误提取逻辑不统一，可能显示成 `[object Object]`。

#### 必须修复
1. 统一错误响应结构，例如：
```json
{
  "error": {
    "code": "AUTH_FAILED",
    "message": "Invalid credentials"
  }
}
```
2. 前端统一从 `error.message` 提取提示。
3. 不要把原始对象直接转成字符串显示。

#### 验收标准
- 用户界面不会出现 `[object Object]`。
- 所有错误提示都能正常展示可读 message。

---

### 13. 审查 root 运行必要性，尽可能收缩 systemd 权限

#### 问题
systemd 当前以 `User=root` 运行。虽然配置了部分 hardening，但一旦应用被打穿，影响面仍很大。

#### 必须修复
1. 评估是否可改为专用低权限服务账号。
2. 仅对白名单资源放开访问：
   - MySQL socket
   - Dovecot 所需二进制/校验能力
   - Postfix 配置目录（如必须）
3. 保持现有 hardening 并尽量收紧。

#### 验收标准
- 服务在非 root 用户下可稳定运行，或有明确文档说明必须 root 的原因。
- 文件系统与执行权限范围被最小化。

---

## 建议执行顺序

### 第一批（当天完成）
1. 删除真实密钥并轮换
2. 修复管理员会话授权问题
3. 下线或限制 maps 接口
4. 临时关闭默认 proxy trust（如条件允许）

### 第二批（1~3 天内）
5. 移除 `X-Mail-Password` 方案
6. 加限流与 CSRF
7. 修复前后端字段不一致
8. 统一 build / dist / deploy 路径

### 第三批（随后优化）
9. 统一 migration 策略
10. IMAP 改用 UID
11. 收缩 systemd 权限
12. 统一错误响应处理

---

## 交付要求

开发完成后，需要至少提交以下结果：
1. 修复代码
2. 更新后的部署文档
3. 变更说明（说明哪些接口或字段有变化）
4. 回归测试结果，至少覆盖：
   - 管理员降权/禁用即时生效
   - portal 登录与 webmail 正常
   - 域名/邮箱/别名增删改状态切换正常
   - 前端 build 后能直接部署
   - 安装脚本按文档可执行

---

## 备注

本清单以“先封堵高危风险，再修复上线 bug”为原则。若开发资源有限，请优先处理 P0 和 P1。