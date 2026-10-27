# ASTMS

ASTMS（A simple temporary mailbox service）是一个无需注册的临时邮箱服务。用户创建 `prefix@MAILBOX_DOMAIN` 地址后，在页面保持前台期间接收邮件；页面隐藏、断网或关闭后停止续期，地址在 TTL 到期后失效。

也可以使用 GitHub、Google 或 SB.SB 论坛账号登录，在 `/dashboard` 中创建长期保留的固定邮箱；登录默认只提供第三方账号，可按需开启邮箱密码登录。

> 隐私边界：匿名邮箱的地址就是访问凭证，任何知道完整地址的人都能查看邮件；固定邮箱仅本人登录后可读。请勿用于敏感或正式用途。

## 功能

- 自定义前缀，或留空生成「名-姓+三位数」形式的随机地址（如 `tom-holland150`）。
- 页面可见且在线时默认每 10 秒轮询并续期；离开前台或断网后停止。
- Mailtrap Inbound Webhook 通知后，服务端拉取完整邮件并写入 Turso/libSQL。
- 邮件列表、详情、纯文本与净化后的 HTML 视图。
- 过期地址不可读，旧邮件不会继承到新邮箱。
- `SITE_NAME` 可配置品牌名，前台显示为 `@SITE_NAME`。
- HMAC 验签、事件幂等、多收件人匹配和事务入库。
- 首页左上区域右上角提供登录入口：未登录显示「登录」，登录后显示头像与「进入后台」；登录成功进入 `/dashboard` 管理固定邮箱。
- 每个登录用户最多 50 个固定邮箱，永久保留；满 50 个后新建自动淘汰最久未打开的邮箱。
- 固定邮箱仅本人登录态可读，地址可以分享给任何人用于收信；固定邮箱收件忽略 local part 点号（发往 `a.b.c@` 的邮件会进入 `abc@`）。
- 第三方登录支持 GitHub、Google、SB.SB 论坛（OIDC），只显示已配置凭据的 provider；可选邮箱密码登录（`EMAIL_PASS_LOGIN`），首次登录自动注册。

## 技术栈

TanStack Start、TanStack Query、React 19、Tailwind CSS 4、Kumo UI、Better Auth、Drizzle ORM、Turso/libSQL、Mailtrap Inbound、Nitro、Bun。

## 本地开发

要求：Bun 1.4+；真实收件需要已绑定 catch-all 域名的 Mailtrap Inbound Inbox。登录与用户后台是可选的，未配置时匿名临时邮箱不受影响。

```bash
bun install
cp .env.example .env.local
# 编辑 .env.local，填入下方环境变量
bun run db:migrate
bun run dev
```

打开 <http://localhost:3000>。本地数据库默认为 `file:local.db`，已加入 `.gitignore`。

服务在首个请求时校验匿名收件相关配置。仅调试页面时，Mailtrap 变量可以填任意非空占位值；需要真实收件时必须换成 Mailtrap 的真实值。登录相关变量缺失时，登录入口显示「登录暂未开放」，匿名流程不受影响。

### 本地联调真实收件

1. 用 `cloudflared tunnel --url http://localhost:3000` 或 ngrok 暴露本地端口。
2. 在 Mailtrap 创建 Inbound Webhook，URL 填 `https://<tunnel-host>/api/webhooks/mailtrap/inbound`，选择对应 Inbox。
3. 在 Webhook 详情中复制自动生成的 Signing Secret，填入 `MAILTRAP_WEBHOOK_SIGNING_SECRET`，重启开发服务器。

Mailtrap 不允许在后台填写自定义 Signing Secret；Secret 由 Mailtrap 自动生成，重置后旧值立即失效。

### 本地联调登录

1. 在 GitHub、Google 和/或 SB.SB 创建 OAuth/OIDC 应用，回调地址填 `http://localhost:3000/api/auth/callback/github`、`http://localhost:3000/api/auth/callback/google`、`http://localhost:3000/api/auth/callback/sb`。
2. 在 `.env.local` 配置 `BETTER_AUTH_URL=http://localhost:3000`、`BETTER_AUTH_SECRET`（至少 32 个字符的随机值）以及对应 provider 的 client id/secret。
3. 需要验收邮箱密码登录时，额外设置 `EMAIL_PASS_LOGIN=1`；不设置时登录弹窗不显示邮箱密码登录。
4. 重启开发服务器后，从首页左上区域右上角登录。

SB.SB 如果不允许登记 localhost 回调，可以为开发环境单独创建 OIDC 客户端，或者使用指向本机的 HTTPS tunnel 并把 tunnel 域名登记为回调。GitHub、Google 也可以为本地开发单独创建应用。

## 环境变量

匿名临时邮箱只需要第一组变量；登录与用户后台是可选功能，需要额外配置 Better Auth 与 provider 凭据。未配置登录变量时匿名流程正常，登录入口提示「登录暂未开放」。

### 匿名临时邮箱（无需登录）

| 变量                              | 必填 | 默认值          | 说明                                                   |
| --------------------------------- | ---- | --------------- | ------------------------------------------------------ |
| `DATABASE_URL`                    | 是   | `file:local.db` | 本地 libSQL 文件或 Turso `libsql://...` URL            |
| `DATABASE_AUTH_TOKEN`             | 否   | 空              | Turso Token，本地文件不需要                            |
| `SITE_NAME`                       | 否   | `ASTMS`         | 品牌名，显示为 `@SITE_NAME`，并用于页面标题            |
| `MAILBOX_DOMAIN`                  | 是   | 无              | 裸域名，如 `mail.example.com`，不要带 `@` 或协议       |
| `MAILBOX_TTL_SECONDS`             | 否   | `90`            | 匿名邮箱有效期，1–86400 秒                             |
| `MAILBOX_POLL_INTERVAL_SECONDS`   | 否   | `10`            | 轮询间隔，1–300 秒                                     |
| `MAILTRAP_API_TOKEN`              | 是   | 无              | Mailtrap API Token                                     |
| `MAILTRAP_INBOX_ID`               | 是   | 无              | Inbound Inbox ID，必须是整数                           |
| `MAILTRAP_WEBHOOK_SIGNING_SECRET` | 是   | 无              | Mailtrap 自动生成的 Webhook Signing Secret，不能自定义 |
| `CRON_SECRET`                     | 是   | 无              | 内部清理接口的 Bearer Secret                           |

### 登录与用户后台（可选）

| 变量                          | 必填       | 默认值                                    | 说明                                                                                                |
| ----------------------------- | ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`             | 登录时必填 | 无                                        | 站点 origin，如 `http://localhost:3000`、`https://vip.co.fo`；必须与浏览器访问地址和 OAuth 回调一致 |
| `BETTER_AUTH_SECRET`          | 登录时必填 | 无                                        | 至少 32 个字符的随机值，用于签名会话与加密 OAuth token；不要使用示例值                              |
| `BETTER_AUTH_TRUSTED_ORIGINS` | 否         | 空                                        | 额外可信 origin，逗号分隔；默认只信任 `BETTER_AUTH_URL`                                             |
| `EMAIL_PASS_LOGIN`            | 否         | 关闭                                      | 设为 `1` 或 `true`（大小写不敏感）开启邮箱密码登录；不设置或设为 `0` 即关闭；首次登录自动注册       |
| `GITHUB_CLIENT_ID`            | 否         | 空                                        | GitHub OAuth App Client ID；与 Secret 同时配置才启用                                                |
| `GITHUB_CLIENT_SECRET`        | 否         | 空                                        | GitHub OAuth App Client Secret                                                                      |
| `GOOGLE_CLIENT_ID`            | 否         | 空                                        | Google OAuth Client ID；与 Secret 同时配置才启用                                                    |
| `GOOGLE_CLIENT_SECRET`        | 否         | 空                                        | Google OAuth Client Secret                                                                          |
| `SB_OIDC_CLIENT_ID`           | 否         | 空                                        | SB.SB OIDC Client ID；与 Secret 同时配置才启用                                                      |
| `SB_OIDC_CLIENT_SECRET`       | 否         | 空                                        | SB.SB OIDC Client Secret                                                                            |
| `SB_OIDC_ISSUER`              | 否         | `https://sb.sb/oidc`                      | OIDC issuer，服务通过 discovery 获取端点                                                            |
| `SB_OIDC_REDIRECT_URI`        | 否         | `${BETTER_AUTH_URL}/api/auth/callback/sb` | 仅当 SB.SB 登记的回调不是默认值时覆盖                                                               |
| `SB_OIDC_SCOPES`              | 否         | `openid profile offline_access`           | 空格分隔；登录后仅加密保存 refresh token，不调用论坛 API                                            |

三个 provider 相互独立：只配置一组时登录弹窗只显示该 provider；全部未配置且未开启 `EMAIL_PASS_LOGIN` 时显示「登录暂未开放」。`EMAIL_PASS_LOGIN` 不影响第三方登录，两者可以同时开启；邮箱密码登录同样依赖 `BETTER_AUTH_URL` 与 `BETTER_AUTH_SECRET`，但不依赖 provider。

## 用户后台

### 登录方式

- 登录变量未配置或没有任何可用登录方式时，弹窗显示「登录暂未开放」，匿名功能不受影响。
- 第三方登录：GitHub、Google、SB.SB 论坛（OIDC）。登录弹窗只显示服务端已配置 client id + secret 的 provider。
- 邮箱密码登录：默认关闭。`EMAIL_PASS_LOGIN` 设为 `1` 或 `true`（大小写不敏感）后，登录弹窗出现「邮箱密码登录」：邮箱 + 密码 + 单个「登录 / 注册」按钮。
  - 该邮箱第一次登录时自动注册并登录，没有单独的注册入口。
  - 密码长度 8–128 位。
  - 不做邮箱验证，也没有找回密码流程。
- 登录成功进入 `/dashboard`；未登录访问 `/dashboard` 会跳回首页并自动打开登录弹窗（`/?login=1`）。
- 不同 provider 视为不同账号，不做账号合并；登录弹窗和后台只展示昵称与头像，不展示第三方或内部占位邮箱。
- 退出登录只清理本站会话；SB.SB 退出不会连带退出论坛。

### 固定邮箱

- 每个账号最多 50 个固定邮箱，永久保留，不会因 TTL 过期；后台显示「已用 N / 50」。
- 新建第 51 个时自动淘汰最久未打开的邮箱：按最近打开时间（`lastSeenAt`）最早、其次创建时间最早的顺序硬删除，并在界面提示被删除的地址。地址不可用或创建失败时不淘汰。
- 打开某个固定邮箱会更新「最近打开」时间；仅浏览列表不更新。
- 删除邮箱会立即清除地址与全部邮件，无法恢复；删除后可以重新创建同名地址。
- 地址与匿名邮箱共用命名空间：其他用户的固定邮箱或活跃的匿名邮箱占用目标地址时拒绝创建；已过期的匿名邮箱会先结束，再创建固定邮箱。
- 输入自己已有的固定邮箱前缀时直接打开现有邮箱，不新建，也不会触发淘汰；留空前缀才随机生成新地址。
- 固定邮箱不要求用户在线：Webhook 收到邮件即入库，下次打开后台即可看到。
- 后台收件箱最多返回最近 200 封邮件；轮询仅在页面可见且在线时进行，邮件仍由 Webhook 持续入库。
- 创建时留空前缀会随机生成「名-姓+三位数」形式的地址。

### 地址与投递规则

- 固定邮箱前缀：trim、转小写、移除所有点号后，长度 3–32 位，只允许 `a-z0-9-`，并以字母或数字开头和结尾。
- 示例：`a.b.c` 规范化为 `abc`；`a.b` 规范化为 `ab`，不足 3 位被拒绝；`ab-c` 合法；`a_b` 因非法字符被拒绝。
- 投递时移除收件地址 local part 的点号再匹配：发往 `a.b.c@MAILBOX_DOMAIN` 的邮件会进入固定邮箱 `abc@MAILBOX_DOMAIN`；发往 `a.b@MAILBOX_DOMAIN` 的邮件不会进入 `abc@MAILBOX_DOMAIN`。
- 匿名邮箱仍按完整地址严格匹配，点号不忽略；匿名邮箱规则见下方「匿名地址规则」。

### 与匿名邮箱的差异

| 项目     | 匿名临时邮箱               | 固定邮箱                     |
| -------- | -------------------------- | ---------------------------- |
| 登录要求 | 无需登录                   | 必须登录                     |
| 地址规则 | 6–32 位，禁止点号          | 3–32 位，点号忽略            |
| 收件匹配 | 完整地址严格匹配           | local part 去点后匹配        |
| 生命周期 | 页面在线续期，TTL 到期失效 | 永久保留，删除或被淘汰才失效 |
| 数量限制 | 无账号概念，地址即访问凭证 | 每个账号最多 50 个           |
| 读取权限 | 任何知道完整地址的人       | 仅本人登录态                 |

### 路由

- `/dashboard`：固定邮箱后台，左侧邮箱列表 + 右侧收件箱；支持 `?mailbox=<id>` 深链选中邮箱。
- 未登录或会话过期访问 `/dashboard`：跳回 `/?login=1`，首页自动打开登录弹窗。
- 首页 `/?login=1&error=...` 用于登录取消或失败后的提示，关闭弹窗时清理查询参数。

## 匿名地址规则

- 去空格并转小写，长度 6–32 位，只允许字母、数字和 `-`。
- 必须以字母或数字开头和结尾；留空随机生成 `名-姓+三位数` 形式的前缀（如 `tom-holland150`）。
- 同一时刻同一地址只有一个有效邮箱；仍有效时再次打开会复用现有邮箱。
- 过期后再次使用同一地址会创建新邮箱，不继承旧邮件。
- 严格按完整地址匹配，点号不会被忽略；知道完整地址即可读取。
- 登录后在首页创建的仍是匿名临时地址，固定邮箱需要进入 `/dashboard` 创建。

## 接口

| 方法         | 路径                             | 说明                                                       |
| ------------ | -------------------------------- | ---------------------------------------------------------- |
| `GET`        | `/`                              | 首页：匿名临时邮箱与登录入口                               |
| `GET`        | `/dashboard`                     | 用户后台；未登录重定向到 `/?login=1`                       |
| `GET`/`POST` | `/api/auth/*`                    | Better Auth 认证端点：第三方登录、OAuth 回调、会话与退出   |
| `POST`       | `/api/webhooks/mailtrap/inbound` | Mailtrap 入站 Webhook，使用 `mailtrap-signature` HMAC 验签 |
| `POST`       | `/api/internal/cleanup`          | 清理过期匿名数据，需 `Authorization: Bearer $CRON_SECRET`  |

OAuth 回调路径为 `/api/auth/callback/<provider>`，provider 为 `github`、`google`、`sb`。

Webhook 只处理 `inbound.message_received`，按 `event_id` 和消息唯一约束保证幂等；请求体上限 1 MiB。收件匹配同时查询匿名邮箱（完整地址、未结束、未过期）和固定邮箱（local part 去点、未结束），同一封邮件可落入多个匹配邮箱。

## 常用命令

```bash
bun run dev          # 开发服务器
bun run build        # 构建
bun run preview      # 预览构建
bun run db:generate  # 生成迁移
bun run db:migrate   # 应用迁移
bun run db:studio    # Drizzle Studio
bun test             # 测试
bun run lint         # ESLint
bun run check        # Prettier 检查
bunx tsc --noEmit    # 类型检查
```

## 目录

```text
src/features/auth/                              # 登录入口、登录弹窗、viewer 与 provider 元数据
src/features/mailbox/                           # 匿名与固定邮箱生命周期、Server Functions、页面组件
src/features/mailbox/owned-mailbox-service.ts   # 固定邮箱：50 上限、LRU 淘汰、归属校验
src/features/mailbox/owned-mailbox-functions.ts # 固定邮箱 Server Functions
src/features/mailbox/dashboard-*.tsx            # 后台侧栏与收件箱
src/features/mailtrap/                          # 客户端、验签、Webhook 处理、HTML 净化
src/routes/                                     # 首页、/dashboard、Webhook、认证与清理接口
src/db/                                         # schema、Better Auth 表与 libSQL 连接
src/lib/                                        # Better Auth 配置、客户端与通用工具
src/server/                                     # 配置、限流、写锁
```
