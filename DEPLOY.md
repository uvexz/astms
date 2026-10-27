# 部署 ASTMS

本文档描述将 ASTMS 部署为单实例 Node 服务（Nitro `node-server`）+ Turso/libSQL + Mailtrap Inbound 的推荐流程。

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

- 业务数据保存在 Turso；应用进程不落盘，进程内只保留短期的创建限流状态。
- Mailtrap 负责接收域名邮件并推送 Webhook。
- 清理任务通过带 `CRON_SECRET` 的 POST 请求触发。
- 当前实现按单实例设计；创建接口限流为进程内内存实现。

## 前置条件

- 一台可运行 Node.js 22+ 的服务器，或支持 Node server 的平台。
- Bun 1.4+（安装依赖、迁移、构建）。
- 已绑定 catch-all 域名的 Mailtrap Inbound Inbox。
- Turso 数据库；推荐安装 Turso CLI，也可以使用 Turso 控制台创建数据库并获取 URL/Token。
- 一个可公开访问的 HTTPS 域名，例如 `mail.example.com`。
- 反向代理（推荐）或平台自带的 HTTPS 入口。

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
5. Webhook Signing Secret 由 Mailtrap 在创建 Webhook 时自动生成，不能在后台自定义。创建后从 Webhook 详情中复制，填入 `MAILTRAP_WEBHOOK_SIGNING_SECRET`；重置 Secret 会使旧值立即失效。详细步骤见下方第 8 步。

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

BETTER_AUTH_URL=https://mail.example.com
BETTER_AUTH_SECRET=<random-secret-at-least-32-chars>
```

生成随机 Secret：

```bash
openssl rand -base64 48
```

注意事项：

- `MAILBOX_DOMAIN` 只写裸域名，不要带 `@`、`https://` 或路径。
- `MAILTRAP_INBOX_ID` 必须是整数。
- `MAILTRAP_WEBHOOK_SIGNING_SECRET` 必须使用 Mailtrap 为 Webhook 自动生成的 Secret，在 Webhook 详情中复制；不能在 Mailtrap 后台自定义，也不能用自己生成的值替代。
- `BETTER_AUTH_SECRET` 至少 32 字符。匿名邮箱流程不使用 Better Auth，但缺少它时占位模块会输出默认 secret 警告。
- 服务在首个请求时校验配置。缺失或非法时返回 500，并在服务端日志中列出变量名，不会打印 Secret 值。
- 生产环境不要使用 `.env.local` 或示例占位值。

调整 TTL 和轮询间隔：

- `MAILBOX_TTL_SECONDS` 越大，页面离开前台后地址存活越久；默认 90 秒。
- `MAILBOX_POLL_INTERVAL_SECONDS` 越大，前台请求越少，但新邮件出现和续期越慢；默认 10 秒。
- 两者都应按实际部署调整，不建议 TTL 小于轮询间隔。

## 4. 初始化数据库

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

应看到 `mailboxes`、`messages`、`webhook_receipts`（以及 Drizzle 迁移记录表）。

生产环境使用 `db:migrate`，不要依赖 `db:push`。

## 5. 构建

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
grep -RIl "MAILTRAP_API_TOKEN\|MAILTRAP_WEBHOOK_SIGNING_SECRET\|DATABASE_AUTH_TOKEN\|CRON_SECRET" .output/public || true
```

## 6. 运行服务

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

## 7. 反向代理与 HTTPS

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

### Caddy 示例

```caddyfile
mail.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 会自动申请证书并设置转发头。

## 8. 配置 Mailtrap Webhook

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

## 9. 配置清理定时任务

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

即使清理任务没有运行，读取和 Webhook 匹配也会检查过期时间，过期邮箱不可读；定时任务用于物理删除旧数据。

## 10. 上线验收

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

### 真实邮件检查

1. 打开站点，创建一个地址。
2. 保持页面在前台并在线。
3. 向该地址发送一封真实邮件。
4. 邮件应在约 10 秒内出现在右侧收件箱。
5. 在 Mailtrap Webhook 日志中确认返回 200。

### 数据库检查

```bash
turso db shell astms \
  "select address, datetime(last_seen_at/1000,'unixepoch') as last_seen, datetime(expires_at/1000,'unixepoch') as expires, ended_at from mailboxes order by created_at desc limit 5;"

turso db shell astms \
  "select event_id, outcome, datetime(processed_at/1000,'unixepoch') as processed from webhook_receipts order by processed_at desc limit 5;"
```

### 生命周期检查

1. 页面切到后台，等待超过 TTL。
2. 回到页面，应显示过期状态，旧邮件不再展示。
3. 使用同一地址重新开始，应创建新的邮箱 ID，且看不到旧邮件。

## 11. 安全与运维

- 所有生产流量必须走 HTTPS；复制地址功能也依赖安全上下文。
- Secret 只存在于服务器/平台 Secret 中；不要提交 `.env.local`。
- 使用独立且足够长的 `CRON_SECRET`，并限制清理入口只允许 POST。
- Mailtrap API Token、Webhook Signing Secret、Turso Token 和 `CRON_SECRET` 应分别管理，定期轮换；轮换后重启服务。
- 应用已在服务端设置基础安全响应头；反向代理不要覆盖。
- 创建接口当前为进程内限流（默认 20 次/分钟/IP）。多实例部署时，限流不会跨实例共享，建议在反向代理层增加限流或改用共享存储。
- 邮件 HTML 在入库前净化，前端通过 `sandbox=""` iframe 展示；不要绕过净化直接渲染原始 HTML。
- 日志只记录变量名、事件 ID、状态码和错误类型，不记录 Token、签名、完整邮件正文或完整 Webhook payload。
- 备份 Turso 数据库，并确认恢复流程。迁移是前向的，回滚代码前先评估 schema 兼容性。
- 如未来接入 Better Auth，需要配置真实数据库适配器并重新设计用户/匿名邮箱关系；当前匿名邮箱不依赖登录。

## 12. 故障排查

| 现象                                                      | 可能原因                                                          | 处理                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 首个页面请求 500，日志出现 `Invalid server configuration` | 环境变量缺失或格式非法                                            | 按日志列出的变量名补齐；确认 `MAILBOX_DOMAIN` 是裸域名、Inbox ID 是整数       |
| 启动日志出现 Better Auth default secret                   | 未设置或 Secret 太短                                              | 设置至少 32 字符的 `BETTER_AUTH_SECRET`                                       |
| Webhook 返回 401                                          | Signing Secret 不匹配、缺少 `mailtrap-signature`、代理修改了 body | 使用 Mailtrap Webhook 详情中自动生成的 Secret；确保代理不重写/压缩/重排请求体 |
| Webhook 返回 400                                          | JSON 非法或结构不符合 event schema                                | 检查 Mailtrap payload；该请求不会重试                                         |
| Webhook 返回 500                                          | Mailtrap API 临时故障、数据库故障                                 | 查看服务日志；Mailtrap 会在 5 分钟后重试                                      |
| Webhook 返回 413                                          | 请求体超过 1 MiB                                                  | 检查代理限制与 Mailtrap payload                                               |
| 页面上没有新邮件                                          | 地址已过期、页面隐藏/离线、Inbox ID 错误、Token 权限不足          | 保持页面前台；检查 `mailboxes` 的 `expires_at` 与 `webhook_receipts`          |
| 地址很快过期                                              | 页面被切到后台、网络断开、TTL 太短                                | 检查浏览器状态；按需调整 `MAILBOX_TTL_SECONDS`                                |
| 本地并发创建出现 `TRANSACTION_ACTIVE`                     | 本地 libSQL 单连接限制                                            | 当前写锁已串行化；多实例请使用 Turso，不要共享本地文件                        |
| 清理接口 401                                              | `CRON_SECRET` 不一致或缺少 Bearer                                 | 检查环境文件与请求头                                                          |
| 复制按钮无效                                              | 非 HTTPS 或浏览器拒绝剪贴板权限                                   | 使用 HTTPS；在用户手势中点击                                                  |
| Turso 认证失败                                            | Token 过期或数据库 URL 错误                                       | 重新生成 Token，确认 `libsql://` URL                                          |
| 客户端包中出现异常配置                                    | 误把服务端变量改成 `VITE_` 或构建时注入                           | 保持 Secret 只能在服务端；重新构建并扫描 `.output/public`                     |

## 13. 更新与回滚

更新流程：

1. 备份数据库。
2. 拉取新代码，执行 `bun install --frozen-lockfile`。
3. 执行 `bun run db:migrate`（先确认迁移内容）。
4. 执行静态检查和构建。
5. 替换 `.output/`，重启服务。
6. 按上线验收清单检查页面、Webhook 和清理任务。

回滚流程：

- 保留上一版 `.output/`，代码回滚只需切回旧产物并重启。
- 数据库迁移没有自动回滚；如果新版本包含破坏性 schema 变更，先用 Turso 备份恢复。
- 回滚后确认 Webhook Secret、Token 和清理任务仍与新版本兼容。

## 14. 参考

- Mailtrap Inbound Webhooks：<https://docs.mailtrap.io/inbound-email/webhooks.md>
- Mailtrap 获取单封邮件：<https://docs.mailtrap.io/developers/inbound/messages/get-a-message.md>
- Kumo UI：<https://kumo-ui.com/>
- Nitro Node server：<https://v3.nitro.build/deploy>
- Turso：<https://turso.tech/>
