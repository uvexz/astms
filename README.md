# ASTMS

ASTMS（A simple temporary mailbox service）是一个无需注册的临时邮箱服务。用户创建 `prefix@MAILBOX_DOMAIN` 地址后，在页面保持前台期间接收邮件；页面隐藏、断网或关闭后停止续期，地址在 TTL 到期后失效。

> 隐私边界：任何知道完整邮箱地址的人都能查看该邮箱的邮件。请勿用于敏感或正式用途。

## 功能

- 自定义前缀，或留空生成「名-姓+三位数」形式的随机地址（如 `tom-holland150`）。
- 页面可见且在线时默认每 10 秒轮询并续期；离开前台或断网后停止。
- Mailtrap Inbound Webhook 通知后，服务端拉取完整邮件并写入 Turso/libSQL。
- 邮件列表、详情、纯文本与净化后的 HTML 视图。
- 过期地址不可读，旧邮件不会继承到新邮箱。
- `SITE_NAME` 可配置品牌名，前台显示为 `@SITE_NAME`。
- HMAC 验签、事件幂等、多收件人匹配和事务入库。

## 技术栈

TanStack Start、TanStack Query、React 19、Tailwind CSS 4、Kumo UI、Drizzle ORM、Turso/libSQL、Mailtrap Inbound、Nitro、Bun。

## 本地开发

要求：Bun 1.4+；真实收件需要已绑定 catch-all 域名的 Mailtrap Inbound Inbox。

```bash
bun install
cp .env.example .env.local
# 编辑 .env.local，填入下方环境变量
bun run db:migrate
bun run dev
```

打开 <http://localhost:3000>。本地数据库默认为 `file:local.db`，已加入 `.gitignore`。

服务在首个请求时校验配置。仅调试页面时，Mailtrap 变量可以填任意非空占位值；需要真实收件时必须换成 Mailtrap 的真实值。

### 本地联调真实收件

1. 用 `cloudflared tunnel --url http://localhost:3000` 或 ngrok 暴露本地端口。
2. 在 Mailtrap 创建 Inbound Webhook，URL 填 `https://<tunnel-host>/api/webhooks/mailtrap/inbound`，选择对应 Inbox。
3. 在 Webhook 详情中复制自动生成的 Signing Secret，填入 `MAILTRAP_WEBHOOK_SIGNING_SECRET`，重启开发服务器。

Mailtrap 不允许在后台填写自定义 Signing Secret；Secret 由 Mailtrap 自动生成，重置后旧值立即失效。

## 环境变量

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
| `BETTER_AUTH_URL`                 | 否   | 无              | Better Auth 占位配置                                   |
| `BETTER_AUTH_SECRET`              | 建议 | 无              | Better Auth 占位配置，匿名邮箱流程不使用               |

## 地址规则

- 去空格并转小写，长度 6–32 位，只允许字母、数字和 `-`。
- 必须以字母或数字开头和结尾；留空随机生成 `名-姓+三位数` 形式的前缀（如 `tom-holland150`）。
- 同一时刻同一地址只有一个有效邮箱；仍有效时再次打开会复用现有邮箱。
- 过期后再次使用同一地址会创建新邮箱，不继承旧邮件。

## 接口

| 方法   | 路径                             | 说明                                                       |
| ------ | -------------------------------- | ---------------------------------------------------------- |
| `POST` | `/api/webhooks/mailtrap/inbound` | Mailtrap 入站 Webhook，使用 `mailtrap-signature` HMAC 验签 |
| `POST` | `/api/internal/cleanup`          | 清理过期数据，需 `Authorization: Bearer $CRON_SECRET`      |
| `GET`  | `/`                              | 页面入口                                                   |

Webhook 只处理 `inbound.message_received`，按 `event_id` 和消息唯一约束保证幂等；请求体上限 1 MiB。

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
src/features/mailbox/   # 生命周期、Server Functions、页面组件
src/features/mailtrap/  # 客户端、验签、Webhook 处理、HTML 净化
src/routes/             # 首页、Webhook、清理接口
src/db/                 # schema 与 libSQL 连接
src/server/             # 配置、限流、写锁
```
