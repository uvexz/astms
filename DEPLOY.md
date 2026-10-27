# 部署 ASTMS

本文档描述将 ASTMS 部署为单实例 Node 服务（Nitro `node-server`）+ Turso/libSQL + Mailtrap Inbound + Better Auth（可选登录）的推荐流程。

## 目标架构

```text
                    HTTPS
Internet ──────────────────> 反向代理（Nginx / Caddy）
                                   │
                                   ▼
                        ASTMS Node 服务 :3000
                          │             ▲
                          │             │ Bearer
                          │        Mailtrap Webhook
                          ▼
                     Turso / libSQL
                          ▲
                          │ 每 5 分钟
                    清理定时任务
```

- 业务数据保存在 Turso；应用进程不落盘，进程内只保留短期的限流状态。
- Mailtrap 负责接收域名邮件并推送 Webhook。
- Better Auth 与业务数据共用同一个 Turso 数据库；GitHub、Google、SB.SB 的 OAuth/OIDC 回调由本服务处理。
- 清理任务通过带 `CRON_SECRET` 的 POST 请求触发，只处理匿名邮箱。
- 当前实现按单实例设计；匿名创建、固定邮箱操作和认证端点的限流均为进程内内存实现。

## 前置条件

- 一台可运行 Node.js 22+ 的服务器，或支持 Node server 的平台。
- Bun 1.4+（安装依赖、迁移、构建）。
- 已绑定 catch-all 域名的 Mailtrap Inbound Inbox。
- Turso 数据库；推荐安装 Turso CLI，也可以使用 Turso 控制台创建数据库并获取 URL/Token。
- 一个可公开访问的 HTTPS 域名，例如 `mail.example.com`；登录功能还需要用户实际访问的站点 origin（本项目生产为 `https://vip.co.fo`）。
- 反向代理（推荐）或平台自带的 HTTPS 入口。
- 如需登录：GitHub OAuth App、Google OAuth Client 和/或 SB.SB OIDC Client 的 client id/secret，以及已登记的回调地址。只配置部分 provider 时，登录弹窗只显示已配置项。

## 1. 创建 Turso 数据库

```bash
turso db create astms
turso db show astms --url
turso db tokens create astms
```

得到：

```dotenv
DATABASE_URL=libsql://astms-<org>.turso.io
DATABASE_AUTH_TOKEN=<token>
```

不要将 Token 写入仓库。生产环境使用平台 Secret 或服务器上的环境文件。

## 2. 准备 Mailtrap

1. 确认 Inbound Inbox 已绑定并验证 catch-all 域名。
2. 获取 API Token（需要访问 Inbound Inbox）。
3. 获取 Inbound Inbox ID，填入 `MAILTRAP_INBOX_ID`。
4. 本期只需要 `inbox_id + message_id` 拉取单封邮件；`folder_id` 和 `domain_id` 不参与运行配置。
5. Webhook Signing Secret 由 Mailtrap 在创建 Webhook 时自动生成，不能在后台自定义。创建后从 Webhook 详情中复制，填入 `MAILTRAP_WEBHOOK_SIGNING_SECRET`；重置 Secret 会使旧值立即失效。详细步骤见下方第 9 步。

## 3. 配置生产环境变量

在服务器上创建仅服务账号可读的环境文件，例如 `/etc/astms.env`：

```dotenv
DATABASE_URL=libsql://astms-<org>.turso.io
DATABASE_AUTH_TOKEN=<turso-token>

SITE_NAME=ASTMS
MAILBOX_DOMAIN=mail.example.com
MAILBOX_TTL_SECONDS=90
MAILBOX_POLL_INTERVAL_SECONDS=10

MAILTRAP_API_TOKEN=<mailtrap-api-token>
MAILTRAP_INBOX_ID=<numeric-inbox-id>
MAILTRAP_WEBHOOK_SIGNING_SECRET=<webhook-signing-secret>

CRON_SECRET=<long-random-secret>

# Better Auth（登录必填；匿名功能不需要）
BETTER_AUTH_URL=https://vip.co.fo
BETTER_AUTH_SECRET=<random-secret-at-least-32-chars>
# 可选：额外可信 origin，逗号分隔；留空时只信任 BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS=

# 可选邮箱 + 密码登录：不设置=关闭，设为 1 或 true 开启
EMAIL_PASS_LOGIN=

# GitHub OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# SB.SB OIDC
SB_OIDC_CLIENT_ID=
SB_OIDC_CLIENT_SECRET=
SB_OIDC_ISSUER=https://sb.sb/oidc
# 可选覆盖，默认 ${BETTER_AUTH_URL}/api/auth/callback/sb
SB_OIDC_REDIRECT_URI=
# 可选覆盖，默认 openid profile offline_access
SB_OIDC_SCOPES=
```

生成随机 Secret：

```bash
openssl rand -base64 48
```

注意事项：

- `MAILBOX_DOMAIN` 只写裸域名，不要带 `@`、`https://` 或路径。
- `MAILTRAP_INBOX_ID` 必须是整数。
- `MAILTRAP_WEBHOOK_SIGNING_SECRET` 必须使用 Mailtrap 为 Webhook 自动生成的 Secret，在 Webhook 详情中复制；不能在 Mailtrap 后台自定义，也不能用自己生成的值替代。
- `BETTER_AUTH_URL` 必须与浏览器实际访问的站点 origin 完全一致（本项目生产为 `https://vip.co.fo`），否则登录跳转和 OAuth 回调会失败。它也是三个 provider 默认回调地址的基址。
- `BETTER_AUTH_SECRET` 至少 32 个字符（建议使用 32 字节以上的随机值），生产必须使用独立随机值。匿名邮箱流程不读取它，但登录功能缺少或过短时会报配置错误。
- `EMAIL_PASS_LOGIN` 默认不设置即关闭（设为 `0` 或其他非 `1`/`true` 值同样关闭）；只有显式设为 `1` 或 `true`（大小写不敏感）才开启邮箱 + 密码登录。开启后没有邮箱验证和找回密码，建议只在确有需要时启用。
- provider 凭据按对配置：`GITHUB_*`、`GOOGLE_*`、`SB_OIDC_*` 各自需要 client id 与 secret 同时存在，否则视为未配置，登录弹窗不会显示该 provider。
- `SB_OIDC_REDIRECT_URI` 与 `SB_OIDC_SCOPES` 通常留空即可；只有 SB.SB 登记的回调或 scope 与默认值不同时才覆盖。
- 未配置任何登录变量时，匿名首页、Webhook 和清理任务照常运行，登录弹窗显示「登录暂未开放」。
- 服务在首个请求时校验匿名收件相关配置。缺失或非法时返回 500，并在服务端日志中列出变量名，不会打印 Secret 值。
- 生产环境不要使用 `.env.local` 或示例占位值。

调整 TTL 和轮询间隔：

- `MAILBOX_TTL_SECONDS` 越大，页面离开前台后地址存活越久；默认 90 秒。
- `MAILBOX_POLL_INTERVAL_SECONDS` 越大，前台请求越少，但新邮件出现和续期越慢；默认 10 秒。
- 两者都应按实际部署调整，不建议 TTL 小于轮询间隔。

## 4. 注册 OAuth 应用并登记回调

登录使用 GitHub、Google 和 SB.SB 论坛（OIDC）三个 provider，按需注册。只配置其中一部分时，登录弹窗只显示已配置项。

| Provider | 注册位置                                                                                  | 生产回调地址                                 |
| -------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| GitHub   | GitHub Settings → Developer settings → OAuth Apps                                         | `https://vip.co.fo/api/auth/callback/github` |
| Google   | Google Cloud Console → APIs & Services → Credentials → OAuth client ID（Web application） | `https://vip.co.fo/api/auth/callback/google` |
| SB.SB    | SB.SB 论坛提供的 OIDC 客户端管理入口                                                      | `https://vip.co.fo/api/auth/callback/sb`     |

登记步骤：

1. GitHub：创建 OAuth App，Homepage URL 填 `https://vip.co.fo`，Authorization callback URL 填上表地址；创建后把 Client ID 与 Client Secret 写入 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`。
2. Google：创建 OAuth client ID（类型 Web application），Authorized redirect URI 填上表地址，并按需配置 OAuth 同意屏幕。Google 的同意屏幕验证和域名配置可能需要审核时间，需预留上线窗口。
3. SB.SB：创建 OIDC 客户端，回调填上表地址，scope 使用 `openid profile offline_access`，启用 PKCE（S256）。`SB_OIDC_ISSUER` 默认 `https://sb.sb/oidc`，服务通过 discovery 获取授权、token 和 userinfo 端点，通常不需要手工填写端点。

本地开发回调：

| Provider | 本地回调地址                                           |
| -------- | ------------------------------------------------------ |
| GitHub   | `http://localhost:3000/api/auth/callback/github`       |
| Google   | `http://localhost:3000/api/auth/callback/google`       |
| SB.SB    | 需单独注册开发客户端，或使用 HTTPS tunnel 域名作为回调 |

注意事项：

- 回调地址必须与 `BETTER_AUTH_URL` 的 origin 和 provider 后台登记值完全一致；更换域名后三个 provider 都要同步更新。
- SB.SB 不申请 `email` scope，服务端用 OIDC `sub` 生成内部占位邮箱；不需要向 SB.SB 申请邮箱字段。
- 未配置任何 provider 时也能部署，登录弹窗显示「登录暂未开放」，匿名功能不受影响。
- 若开启 `EMAIL_PASS_LOGIN`，邮箱密码登录不依赖上述 provider，但同样依赖 `BETTER_AUTH_URL` 与 `BETTER_AUTH_SECRET`。

## 5. 初始化数据库

迁移前先备份 Turso 数据库（Turso 控制台备份/分支，或导出后保存到安全位置），并确认恢复流程可用。`drizzle/0001_fine_nico_minoru.sql` 会：

- 创建 Better Auth 表：`user`、`session`、`account`、`verification`；
- 给 `mailboxes` 增加可空的 `user_id` 外键与 `(user_id, ended_at)` 索引。

该迁移只新增表和列，不做表重建，现有匿名邮箱与邮件不受影响。仍建议先在现有数据库副本上演练一次，确认匿名创建、收件、过期和清理正常后再操作生产。

在仓库目录执行迁移，确保迁移使用生产 Turso 环境：

```bash
export DATABASE_URL='libsql://astms-<org>.turso.io'
export DATABASE_AUTH_TOKEN='<token>'
bun run db:migrate
```

迁移可以重复执行。验证表已创建：

```bash
turso db shell astms "select name from sqlite_master where type='table' order by name;"
```

应看到 `mailboxes`、`messages`、`webhook_receipts`，以及 `user`、`session`、`account`、`verification`（还有 Drizzle 迁移记录表）。

确认 `mailboxes` 已包含 `user_id`：

```bash
turso db shell astms "pragma table_info(mailboxes);"
```

迁移后回归一次匿名流程：创建地址、保持前台收信、等待 TTL 过期、再用同一地址创建新邮箱。固定邮箱此时还没有数据；登录并创建后才会出现 `user_id` 非空的记录。

生产环境使用 `db:migrate`，不要依赖 `db:push`。

## 6. 构建

```bash
bun install --frozen-lockfile
bun run lint
bun run check
bunx tsc --noEmit
bun test
bun run build
```

构建输出为 `.output/`，启动入口是 `.output/server/index.mjs`。

重要：

- `.output` 中包含平台相关的 libSQL 原生依赖。请在目标操作系统/CPU 架构上构建，或在与运行环境一致的 CI 容器中构建；不要把 macOS 构建产物直接部署到 Linux。
- 构建产物是自包含的 Node server，复制整个 `.output/` 即可，不要只复制 `index.mjs`。
- 不要把生产 Secret 写入任何 `VITE_` 变量；应用只在服务端读取。部署前仍应检查客户端资源不包含 Secret：

```bash
grep -RIl "MAILTRAP_API_TOKEN\|MAILTRAP_WEBHOOK_SIGNING_SECRET\|DATABASE_AUTH_TOKEN\|CRON_SECRET\|BETTER_AUTH_SECRET\|GITHUB_CLIENT_SECRET\|GOOGLE_CLIENT_SECRET\|SB_OIDC_CLIENT_SECRET" .output/public || true
```

## 7. 运行服务

### 直接运行

```bash
cd /srv/astms
HOST=0.0.0.0 PORT=3000 node .output/server/index.mjs
```

Nitro 会读取：

- `PORT` 或 `NITRO_PORT`，默认 3000
- `HOST` 或 `NITRO_HOST`

生产环境变量应由平台 Secret、systemd `EnvironmentFile` 或容器环境注入。Nitro 的独立 Node 产物不会自动读取 `.env.local`。

本地验证生产产物时，可以用 Node 22+ 的 `--env-file`：

```bash
node --env-file=.env.local .output/server/index.mjs
```

或直接使用：

```bash
bun run preview
```

### systemd 示例

`/etc/systemd/system/astms.service`：

```ini
[Unit]
Description=ASTMS temporary mailbox
After=network.target

[Service]
Type=simple
User=astms
Group=astms
WorkingDirectory=/srv/astms
EnvironmentFile=/etc/astms.env
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 600 /etc/astms.env
sudo systemctl daemon-reload
sudo systemctl enable --now astms
sudo systemctl status astms
sudo journalctl -u astms -f
```

### Docker 示例（可选）

Dockerfile 示例：

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

构建和运行示例：

```bash
docker build -t astms .
docker run --rm -p 3000:3000 --env-file /etc/astms.env astms
```

说明：

- 构建阶段必须在 Linux 容器内完成，确保 libSQL 原生依赖与运行镜像一致；ARM 服务器需要使用对应架构的构建平台。
- 使用 `node:22-bookworm-slim` 而不是 Alpine，避免 glibc 原生依赖不匹配。
- 必须添加 `.dockerignore`，至少排除 `.env*`、`local.db`、`node_modules`、`.output`，避免把本地配置和旧构建产物带进镜像构建上下文。

## 8. 反向代理与 HTTPS

Webhook、复制到剪贴板和现代浏览器能力都要求 HTTPS。

### Nginx 示例

```nginx
server {
    listen 80;
    server_name mail.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mail.example.com;

    ssl_certificate     /etc/letsencrypt/live/mail.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.example.com/privkey.pem;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        # 覆盖客户端传入的 X-Forwarded-For，避免绕过创建接口限流
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

注意：

- 不要修改或重新序列化 Webhook 请求体；签名基于原始 body。
- `client_max_body_size` 与应用内 1 MiB 限制保持一致。
- 如果服务部署在 CDN 后面，按 CDN 的真实 IP 头配置 `X-Forwarded-For`，并确认只有可信代理能设置该头。
- 示例把站点写作 `mail.example.com`。如果站点 origin 是 `https://vip.co.fo`，把 `server_name`、证书路径、邮件域名和 Webhook URL 一并替换，并确保 `BETTER_AUTH_URL` 与实际访问地址完全一致。

### Caddy 示例

```caddyfile
mail.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 会自动申请证书并设置转发头。

## 9. 配置 Mailtrap Webhook

在 Mailtrap 创建 Inbound Webhook：

- URL：`https://mail.example.com/api/webhooks/mailtrap/inbound`
- 类型：Inbound Inboxes
- 选择对应的 Inbound Inbox
- 复制 Webhook 详情中自动生成的 Signing Secret，写入 `MAILTRAP_WEBHOOK_SIGNING_SECRET`
- Mailtrap 不允许在后台填写自定义 Secret；如果重置 Secret，必须同步更新环境变量并重启服务
- 重启服务

行为说明：

- 只处理 `inbound.message_received`。
- 验签使用 `mailtrap-signature` 和原始请求体的 HMAC-SHA256 十六进制摘要。
- 重复 `event_id` 会被幂等跳过。
- 无需重试的事件返回 200；Mailtrap 临时故障或数据库故障返回 500，Mailtrap 会按策略重试。
- Mailtrap 失败投递默认每 5 分钟重试，最多 40 次。
- 不要在 Webhook URL 上添加自定义查询参数，也不要让代理修改 body。

## 10. 配置清理定时任务

推荐每 5 分钟调用一次：

```bash
POST https://mail.example.com/api/internal/cleanup
Authorization: Bearer <CRON_SECRET>
```

服务器脚本示例 `/usr/local/bin/astms-cleanup`：

```bash
#!/usr/bin/env bash
set -euo pipefail

set -a
source /etc/astms.env
set +a

response="$(
  curl -fsS -X POST "https://mail.example.com/api/internal/cleanup" \
    -H "Authorization: Bearer ${CRON_SECRET}"
)"

echo "${response}" | logger -t astms-cleanup
```

```bash
sudo chmod 700 /usr/local/bin/astms-cleanup
```

crontab：

```cron
*/5 * * * * /usr/local/bin/astms-cleanup >/dev/null 2>&1
```

返回 JSON 包含 `ended`、`deletedMailboxes`、`deletedMessages`、`deletedReceipts`。

清理任务只处理匿名邮箱（`user_id IS NULL`）；固定邮箱永久保留，不参与 TTL 清理，也不在清理任务的响应中计数。固定邮箱的删除只由用户在后台手动操作或被 50 个上限淘汰。

即使清理任务没有运行，读取和 Webhook 匹配也会检查过期时间，过期邮箱不可读；定时任务用于物理删除旧数据。

## 11. 上线验收

### 基础检查

```bash
curl -fsSI https://mail.example.com/ | head -20
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo "local ok"
```

确认存在安全响应头：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`
- `Content-Security-Policy`

### 接口检查

```bash
# 错误 CRON_SECRET 应返回 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://mail.example.com/api/internal/cleanup \
  -H 'Authorization: Bearer wrong'

# 正确 CRON_SECRET 应返回 200
curl -s -X POST https://mail.example.com/api/internal/cleanup \
  -H 'Authorization: Bearer '"$CRON_SECRET"

# 错误签名应返回 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://mail.example.com/api/webhooks/mailtrap/inbound \
  -H 'Content-Type: application/json' \
  -H 'mailtrap-signature: deadbeef' \
  --data '{"events":[]}'
```

登录相关检查（示例使用生产 origin `https://vip.co.fo`，站点域名不同时替换）：

```bash
# 未登录访问后台：应为 3xx，Location 指向 /?login=1
curl -s -o /dev/null -D - https://vip.co.fo/dashboard | head -10

# 未登录请求会话：应返回空会话（null）
curl -fsS https://vip.co.fo/api/auth/get-session

# 认证端点应返回 no-store
curl -fsSI https://vip.co.fo/api/auth/get-session | grep -i cache-control
```

### 真实邮件检查

1. 打开站点，创建一个匿名地址。
2. 保持页面在前台并在线。
3. 向该地址发送一封真实邮件。
4. 邮件应在约 10 秒内出现在右侧收件箱。
5. 在 Mailtrap Webhook 日志中确认返回 200。

### 登录与用户后台检查

1. 匿名回归：未登录首页可正常创建地址并收信；TTL 到期后地址失效，重新创建得到新的邮箱。
2. 未登录访问 `/dashboard`：应跳回首页并自动打开登录弹窗（URL 带 `login=1`）。
3. 登录弹窗只显示已配置凭据的 provider；分别用 GitHub、Google、SB.SB 完成一次真实登录，成功后进入 `/dashboard`。
4. 开启 `EMAIL_PASS_LOGIN=1` 时：用一个从未登录过的邮箱和 8–128 位密码，点击「登录 / 注册」应自动注册并登录；退出后用同一邮箱和正确密码可再次登录；错误密码应提示「邮箱或密码不正确」；密码不足 8 位或超过 128 位时提示对应长度文案。
5. 关闭 `EMAIL_PASS_LOGIN`（不设置或设为 `0`）时：登录弹窗不显示邮箱密码登录；绕过界面直接请求账号密码登录接口会失败（返回 `EMAIL_PASSWORD_DISABLED`），界面只保留第三方登录。
6. 在后台创建一个固定邮箱 `abc`；向 `a.b.c@<MAILBOX_DOMAIN>` 发送真实邮件，邮件应出现在该固定邮箱；匿名页面使用 `abc@` 或 `a.b.c@` 都读不到该邮件。
7. 连续创建到第 51 个：列表保持 50 个，最久未打开的地址被删除，Toast 显示被删除的地址；该邮箱的邮件一并清除。
8. 删除一个固定邮箱：地址和邮件立即清除，之后可重新创建同名地址。
9. 退出登录回到首页；再次登录仍是同一批固定邮箱。
10. 浏览器开发者工具确认会话 Cookie 含 `HttpOnly`、`Secure`（生产）、`SameSite=Lax`。
11. 切换账号后不残留上一账号的固定邮箱列表或邮件（TanStack Query 缓存已清理）。

### 数据库检查

```bash
turso db shell astms \
  "select address, datetime(last_seen_at/1000,'unixepoch') as last_seen, datetime(expires_at/1000,'unixepoch') as expires, ended_at from mailboxes order by created_at desc limit 5;"

turso db shell astms \
  "select user_id, count(*) from mailboxes where ended_at is null and user_id is not null group by user_id;"

turso db shell astms \
  "select count(*) from user;"

turso db shell astms \
  "select event_id, outcome, datetime(processed_at/1000,'unixepoch') as processed from webhook_receipts order by processed_at desc limit 5;"
```

固定邮箱的 `expires_at` 是远期哨兵（9999-12-31），`user_id` 非空；匿名邮箱的 `user_id` 必须为空。

### 生命周期检查

1. 页面切到后台，等待超过 TTL。
2. 回到页面，应显示过期状态，旧邮件不再展示。
3. 使用同一地址重新开始，应创建新的邮箱 ID，且看不到旧邮件。
4. 固定邮箱不参与该检查：关闭页面、离线或超过 TTL 后，地址与邮件都应保留，重新打开后台仍可读取。

## 12. 安全与运维

- 所有生产流量必须走 HTTPS；复制地址功能也依赖安全上下文，OAuth 回调也要求 HTTPS。
- Secret 只存在于服务器/平台 Secret 中；不要提交 `.env.local`，也不要把 Secret 注入 `VITE_` 变量或客户端资源。
- 使用独立且足够长的 `CRON_SECRET`，并限制清理入口只允许 POST。
- Mailtrap API Token、Webhook Signing Secret、Turso Token、`BETTER_AUTH_SECRET`、`CRON_SECRET` 和 provider client secret 应分别管理并定期轮换；轮换后重启服务。
- 应用已在服务端设置基础安全响应头；反向代理不要覆盖。
- 匿名创建接口当前为进程内限流（默认 20 次/分钟/IP）；固定邮箱创建与删除按用户 ID 限流（各 10 次/分钟/用户）。多实例部署时这些限流不会跨实例共享，建议在反向代理层增加限流或改用共享存储。
- 账号密码与第三方登录入口（POST）由应用层按 IP 限流：`/sign-in/email` 与 `/sign-in/social` 各 10 次/分钟/IP，`/sign-up/email` 5 次/分钟/IP，超出返回 429。Better Auth 已关闭 IP tracking（`disableIpTracking`），其自带的认证端点限流不会生效，不能依赖它做防爆破。
- 固定邮箱只能由本人登录态读取：所有固定邮箱查询都按会话 userId 校验归属，越权请求统一返回「不存在」；匿名快照、匿名创建、Webhook 匿名匹配和清理任务都必须保留 `user_id IS NULL` 过滤，移除过滤会把固定邮箱暴露给匿名面。
- `EMAIL_PASS_LOGIN` 默认关闭。开启后不发送验证邮件、没有找回密码流程，密码长度限制为 8–128 位；建议只在确有需要时启用，否则优先保留纯第三方登录。
- OAuth access/refresh/id token 由 Better Auth 加密存储在 `account` 表；不要导出、打印或写入日志。会话 Cookie 使用 HttpOnly、SameSite=Lax、生产 Secure，不要改成 SameSite=Strict，否则 OAuth 回调会丢失 state Cookie。
- 三个 provider 使用内部占位邮箱映射，真实第三方邮箱不写入 user 表，也不做跨 provider 账号合并；不要手动修改 user 表的 email 以保证唯一性。
- 第三方头像来自外部域名；如果后续收紧 CSP，需要为 GitHub/Google/SB.SB 的头像域添加 `img-src`，或改为首字母头像。
- 邮件 HTML 在入库前净化，前端通过 `sandbox=""` iframe 展示；不要绕过净化直接渲染原始 HTML。
- 日志只记录变量名、事件 ID、状态码和错误类型，不记录 Token、签名、完整邮件正文、完整 Webhook payload 或密码。
- 备份 Turso 数据库，并确认恢复流程。迁移是前向的，回滚代码前先评估 schema 兼容性。
- 50 个上限的自动淘汰和手动删除都是破坏性操作：界面必须保留明确文案，运维不要手工删除固定邮箱记录。
- 回滚到不含用户后台的旧版本时，`user`/`session`/`account`、`mailboxes.user_id` 和固定邮箱数据仍会保留，但旧版本会把固定邮箱当作普通邮箱处理（知道地址即可读取、点号匹配失效）。如必须回滚，先评估是否接受该风险或先清理固定邮箱数据。

## 13. 故障排查

| 现象                                                      | 可能原因                                                                   | 处理                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 首个页面请求 500，日志出现 `Invalid server configuration` | 环境变量缺失或格式非法                                                     | 按日志列出的变量名补齐；确认 `MAILBOX_DOMAIN` 是裸域名、Inbox ID 是整数          |
| 登录弹窗只有「登录暂未开放」                              | `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` 缺失或非法，或没有任何可用 provider | 补齐 Better Auth 配置；至少配置一组 provider 或开启 `EMAIL_PASS_LOGIN`；重启服务 |
| 登录接口返回 503 或日志出现 `auth_unavailable`            | 登录配置缺失或 `BETTER_AUTH_URL` 不是合法绝对 URL                          | 检查 `BETTER_AUTH_URL` 与 `BETTER_AUTH_SECRET`；匿名功能不受影响                 |
| 访问 `/dashboard` 跳回首页                                | 未登录、会话过期，或 OAuth 回调后 Cookie 未写入                            | 重新登录；确认 `BETTER_AUTH_URL` 与浏览器地址完全一致、全站 HTTPS                |
| OAuth 登录报 `redirect_uri_mismatch` 或回调 401           | provider 后台登记的回调与 `BETTER_AUTH_URL` 不一致                         | 三处同时修改：`BETTER_AUTH_URL`、provider 回调、反向代理域名                     |
| 回调后仍未登录，Cookie 丢失                               | Cookie 被代理丢弃、SameSite 被改、`BETTER_AUTH_URL` 协议或域名不符         | 保留默认 HttpOnly/SameSite=Lax/Secure；确认代理转发 Host 与 `X-Forwarded-Proto`  |
| 设置了 `EMAIL_PASS_LOGIN` 但弹窗没有邮箱密码登录          | 值不是 `1`/`true`、未重启服务，或登录配置缺失                              | 使用 `EMAIL_PASS_LOGIN=1`；确认 `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` 后重启    |
| 邮箱密码登录提示失败                                      | 密码不在 8–128 位、首次登录未自动注册，或开关已关闭                        | 首次直接点「登录 / 注册」；检查密码长度与 `EMAIL_PASS_LOGIN`                     |
| 固定邮箱收不到 `a.b.c@` 的邮件                            | 目标不是固定邮箱、地址已被删除/淘汰，或 Webhook 未返回 200                 | 确认固定邮箱仍存在；查看 Webhook 日志与 `webhook_receipts`                       |
| 固定邮箱创建提示地址不可用                                | 被其他用户的固定邮箱或活跃匿名邮箱占用                                     | 换前缀；或等待匿名邮箱过期后重试，不要抢占他人地址                               |
| 创建第 51 个后旧邮箱消失                                  | 触发 50 个上限的 LRU 淘汰                                                  | 预期行为；界面会 Toast 显示被删除地址，邮件随邮箱一并删除                        |
| Webhook 返回 401                                          | Signing Secret 不匹配、缺少 `mailtrap-signature`、代理修改了 body          | 使用 Mailtrap Webhook 详情中自动生成的 Secret；确保代理不重写/压缩/重排请求体    |
| Webhook 返回 400                                          | JSON 非法或结构不符合 event schema                                         | 检查 Mailtrap payload；该请求不会重试                                            |
| Webhook 返回 500                                          | Mailtrap API 临时故障、数据库故障                                          | 查看服务日志；Mailtrap 会在 5 分钟后重试                                         |
| Webhook 返回 413                                          | 请求体超过 1 MiB                                                           | 检查代理限制与 Mailtrap payload                                                  |
| 页面上没有新邮件                                          | 地址已过期、页面隐藏/离线、Inbox ID 错误、Token 权限不足                   | 保持页面前台；检查 `mailboxes` 的 `expires_at` 与 `webhook_receipts`             |
| 地址很快过期                                              | 页面被切到后台、网络断开、TTL 太短                                         | 检查浏览器状态；按需调整 `MAILBOX_TTL_SECONDS`                                   |
| 本地并发创建出现 `TRANSACTION_ACTIVE`                     | 本地 libSQL 单连接限制                                                     | 当前写锁已串行化；多实例请使用 Turso，不要共享本地文件                           |
| 清理接口 401                                              | `CRON_SECRET` 不一致或缺少 Bearer                                          | 检查环境文件与请求头                                                             |
| 复制按钮无效                                              | 非 HTTPS 或浏览器拒绝剪贴板权限                                            | 使用 HTTPS；在用户手势中点击                                                     |
| Turso 认证失败                                            | Token 过期或数据库 URL 错误                                                | 重新生成 Token，确认 `libsql://` URL                                             |
| 客户端包中出现异常配置                                    | 误把服务端变量改成 `VITE_` 或构建时注入                                    | 保持 Secret 只能在服务端；重新构建并扫描 `.output/public`                        |

## 14. 更新与回滚

更新流程：

1. 备份数据库，确认备份可恢复。
2. 拉取新代码，执行 `bun install --frozen-lockfile`。
3. 执行 `bun run db:migrate`（先审查 `drizzle/` 中新增迁移，确认只做预期的表/列变更）。
4. 执行静态检查和构建。
5. 替换 `.output/`，重启服务。
6. 按上线验收清单检查匿名首页、登录、后台、Webhook 和清理任务。

回滚流程：

- 保留上一版 `.output/`，代码回滚只需切回旧产物并重启。
- 数据库迁移没有自动回滚；如果新版本包含破坏性 schema 变更，先用 Turso 备份恢复。
- 回滚后确认 Webhook Secret、Token、`BETTER_AUTH_URL`、provider 回调与清理任务仍与新版本兼容。
- 回滚到不含用户后台的版本会丢失固定邮箱的访问隔离（详见「安全与运维」），执行前先确认风险。

## 15. 参考

- Better Auth：<https://www.better-auth.com/docs>
- GitHub OAuth Apps：<https://docs.github.com/en/apps/oauth-apps>
- Google OAuth 2.0：<https://developers.google.com/identity/protocols/oauth2>
- SB.SB OIDC discovery：<https://sb.sb/oidc/.well-known/openid-configuration>
- Mailtrap Inbound Webhooks：<https://docs.mailtrap.io/inbound-email/webhooks.md>
- Mailtrap 获取单封邮件：<https://docs.mailtrap.io/developers/inbound/messages/get-a-message.md>
- Kumo UI：<https://kumo-ui.com/>
- Nitro Node server：<https://v3.nitro.build/deploy>
- Turso：<https://turso.tech/>
