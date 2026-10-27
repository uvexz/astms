# ASTMS 临时邮箱 MVP 实施计划

> ASTMS — A simple temporary mailbox service  
> 日期：2026-10-27  
> 状态：MVP 已落地并通过本地工程/浏览器验收；真实 Mailtrap 端到端待配置凭据

## 1. 本期目标

基于现有 TanStack Start 项目，完成一个无需登录即可创建临时地址并接收邮件的单页服务：

- 技术栈：TanStack Start、TanStack Query、Turso/libSQL、Drizzle ORM、Tailwind CSS、Kumo UI（Base UI）。
- 邮件服务：使用现有 Mailtrap Inbound Inbox 与已验证的 catch-all 域名。
- 用户可输入邮箱前缀，或留空由系统随机生成。
- 点击“开始收件”后，右侧从等待动画切换到实时收件状态。
- Mailtrap Webhook 接收通知，服务端再拉取完整邮件并写入 Turso。
- 前台轮询邮件列表，可查看主题、发件人、时间及邮件正文。
- 匿名邮箱仅在前台在线期间有效；停止在线后经过短宽限期失效。
- 知道完整邮箱地址即可读取邮件，界面必须明确提示该隐私边界。

## 2. 已确认决策

### 2.1 Mailtrap 配置

- 当前 Inbox 已绑定并验证 catch-all 域名。
- 用户提供的 `mailbox_id` 已确认就是 Inbound API/Webhook 中的 `inbox_id`。
- 拉取邮件只需要 `inbox_id + message_id`。
- `folder_id`、`domain_id` 用于创建或管理 Inbox，本期运行时不使用，也不重复创建 Inbox。
- 本期只支持一个域名和一个 Inbox。

### 2.2 匿名邮箱生命周期

- “在线”定义为：页面可见、浏览器网络可用，且页面正在执行收件轮询。
- 建议每 10 秒轮询一次；每次成功轮询同时作为心跳，将地址有效期延长 90 秒。
- 页面隐藏、离线或关闭时停止轮询，不继续续期。
- 超过 90 秒未续期后，邮箱及邮件不可再读取，Webhook 也不再为该地址保存新邮件。
- 页面重新可见时，若已过期则回到失效状态，由用户重新点击“开始收件”。
- 过期时间写入数据库，以服务端时间为准，不能信任浏览器时间。
- TTL 和轮询间隔做成常量或环境配置，便于按实际部署调整。

### 2.3 地址与访问模型

- 地址格式：`prefix@MAILBOX_DOMAIN`。
- 前缀统一 trim、转小写，只允许字母、数字和 `-`，长度建议 6–32；必须以字母或数字开头和结尾。未登录用户不低于 6 位。
- 空前缀使用加密安全随机源生成 10–12 位小写字母数字前缀。
- 同一时刻同一地址只能对应一个有效邮箱。
- 对仍有效的相同地址点击“开始收件”时直接打开现有邮箱，而不是报冲突；任意前台查看者都可读取并续期，这与公开访问模型一致。
- 过期地址允许再次创建；新邮箱使用新的内部 ID，不继承旧邮件。
- 邮件查询以完整地址为公开访问条件，不添加匿名账号、访问令牌或 HttpOnly 会话。
- 页面显示：“知道此地址的人都能查看邮件，请勿用于敏感信息；页面离开前台后地址将很快失效。”

## 3. 明确不做

以下功能不进入本次实现：

- 发件、回复、转发。
- 注册、登录、用户中心。
- 登录用户邮箱永久保留；登录功能落地时再将邮箱关联到用户并取消匿名 TTL。
- 管理员后台。
- 多域名、多 Mailtrap Inbox、动态创建 Inbox。
- 附件下载、原始 `.eml` 下载。
- 邮件全文搜索、标签、已读状态云端同步。
- WebSocket/SSE 推送；MVP 使用 TanStack Query 轮询。
- 邮件回复线程管理。

## 4. 总体流程

### 4.1 创建地址并开始收件

1. 用户输入可选前缀并点击“开始收件”。
2. Server Function 校验并规范化前缀，读取服务端域名配置。
3. 数据库事务先将该地址已到期但尚未关闭的记录标记为结束。
4. 若该地址仍有效，返回现有邮箱；否则创建新邮箱，写入 `created_at`、`last_seen_at`、`expires_at`。部分唯一索引用于处理并发创建竞争。
5. 前端保存当前地址到组件状态，并用 `sessionStorage` 仅用于刷新页面时尝试恢复仍在有效期内的收件状态。
6. 创建或打开成功后启动 TanStack Query 轮询，右侧进入“正在等待邮件”。
7. 每次有效轮询更新服务端心跳并返回邮件；过期后返回明确的 `expired` 状态，前端停止轮询。

### 4.2 Mailtrap 收件

1. Mailtrap 向 `POST /api/webhooks/mailtrap/inbound` 发送通知。
2. 服务端读取原始请求体，使用 `MAILTRAP_WEBHOOK_SIGNING_SECRET` 做 HMAC-SHA256 十六进制签名，并与 `mailtrap-signature` 做常量时间比较。
3. 验签通过后解析 JSON，逐项处理 `events`；只处理 `inbound.message_received`。
4. 检查 `inbox_id` 是否等于配置的 `MAILTRAP_INBOX_ID`；不匹配的请求记录安全日志并确认忽略，避免跨 Inbox 写入。
5. 以 `event_id` 检查是否已处理；重复事件直接返回成功。
6. 调用 `GET https://mailtrap.io/api/inbound/inboxes/{inbox_id}/messages/{message_id}`，使用 Bearer Token 认证。
7. 从响应的 `to` 数组提取并规范化收件地址，仅匹配数据库中仍有效的 ASTMS 地址。
8. 对一个或多个匹配邮箱分别写入邮件；同一邮件可通过唯一约束幂等落入多个邮箱。
9. 邮件写入与 Webhook 处理记录在同一事务中提交，随后返回 HTTP 200。
10. Mailtrap 临时故障、数据库故障等可重试错误返回非 200，让 Mailtrap 按其策略重试；永久无效或无需处理的事件记录后返回 200，避免无意义重试。
11. 下一次前台轮询读取到新邮件并更新右侧列表。

### 4.3 过期清理

- 所有读取和 Webhook 匹配都同时检查 `ended_at` 与 `expires_at`，不能仅依赖清理任务。
- 提供内部 `cleanupExpiredMailboxes` 数据库操作，批量结束并删除过期邮箱，依赖外键级联删除邮件；Webhook 处理记录按独立短保留期清理。
- 在创建邮箱时可顺带执行小批量清理；部署环境再配置每 5 分钟一次的安全定时调用，保证无新用户时也能物理删除。
- 定时入口若暴露为 HTTP，必须使用独立 `CRON_SECRET` 并只允许 POST；不将其做成公开管理接口。

## 5. 数据模型

使用 Drizzle SQLite schema，时间统一以 UTC 存储。内部 ID 使用 UUID 或等价的随机 ID，不使用可枚举自增 ID 作为公开标识。

### 5.1 `mailboxes`

| 字段           | 说明                             |
| -------------- | -------------------------------- |
| `id`           | 主键，随机 ID                    |
| `address`      | 规范化后的完整地址               |
| `local_part`   | 邮箱前缀                         |
| `domain`       | 当前域名，便于未来迁移与数据排查 |
| `created_at`   | 创建时间                         |
| `last_seen_at` | 最近一次有效前台轮询时间         |
| `expires_at`   | 当前有效期截止时间               |
| `ended_at`     | 主动结束或清理时间，可为空       |

索引与约束：

- `address + ended_at` 查询索引。
- 对 `ended_at IS NULL` 的 `address` 建部分唯一索引，防止并发创建重复活动地址。
- `expires_at` 索引，用于有效地址匹配与过期清理。
- 创建记录与关闭过期记录必须放在事务中，避免并发绕过唯一性。

### 5.2 `messages`

| 字段                  | 说明                                                   |
| --------------------- | ------------------------------------------------------ |
| `id`                  | 主键，随机 ID                                          |
| `mailbox_id`          | 关联 `mailboxes.id`，删除邮箱时级联删除                |
| `mailtrap_message_id` | Mailtrap 消息对象 ID，不是 RFC `Message-ID`            |
| `from_address`        | Mailtrap 响应中的 `from`，可为空                       |
| `recipients_json`     | 规范化后的 `to` 数组，以 JSON 文本保存，用于排查与展示 |
| `subject`             | 主题，可为空；界面为空时显示“无主题”                   |
| `text_body`           | 纯文本正文，可为空                                     |
| `html_body`           | HTML 正文，可为空                                      |
| `received_at`         | Mailtrap 的 `received_at`                              |
| `created_at`          | 本地入库时间                                           |

约束与索引：

- 唯一约束：`(mailbox_id, mailtrap_message_id)`。
- 查询索引：`(mailbox_id, received_at)`，列表按收件时间倒序。
- 不保存只有一小时有效期的附件下载 URL 或原始邮件 URL。
- 不保存完整 Webhook 原始报文和不必要的邮件头，减少敏感数据留存。

### 5.3 `webhook_receipts`

| 字段                  | 说明                       |
| --------------------- | -------------------------- |
| `event_id`            | 主键，Mailtrap 唯一事件 ID |
| `inbox_id`            | Mailtrap Inbox ID          |
| `mailtrap_message_id` | 通知中的消息 ID            |
| `outcome`             | `stored` 或 `ignored`      |
| `processed_at`        | 成功处理或确认忽略的时间   |

该表用于事件级幂等与问题排查；只有邮件事务成功或事件被明确忽略后才写入。失败事件不写完成记录，使重试可继续执行。

## 6. 服务端接口与模块

### 6.1 邮箱 Server Functions

建议放在 `src/features/mailbox/` 中，避免把数据库和 Mailtrap 逻辑堆进路由组件。

- `createMailbox`
  - POST mutation，输入 `{ prefix?: string }`。
  - 负责校验、随机前缀、打开现有有效地址或事务创建新地址。
  - 返回 `{ mailboxId, address, expiresAt, joinedExisting }`。
- `getMailboxSnapshot`
  - GET query，输入 `{ address: string }`。
  - 地址不存在或已到期时返回 `{ status: "expired" }`，不泄露历史邮件。
  - 有效时续期并返回 `{ status: "active", address, expiresAt, messages }`。
  - 列表只返回必要摘要字段；正文可随列表返回以简化 MVP，若后续邮件体积增大再拆成详情接口。

输入使用运行时 schema 校验；所有外部响应也先用 schema 校验，再进入数据库。

### 6.2 Mailtrap 客户端

建立单独的服务端模块，只暴露 `getInboundMessage(inboxId, messageId)`：

- 固定 API base URL，不允许客户端传入完整 URL。
- 使用 `Authorization: Bearer <MAILTRAP_API_TOKEN>`。
- 设置请求超时，区分 401/403/404 与网络、429、5xx。
- 校验响应字段，至少覆盖 `id`、`inbox_id`、`from`、`to`、`subject`、`text_body`、`html_body`、`received_at`。
- Token 和错误响应中的敏感信息不得进入浏览器或客户端日志。

### 6.3 Webhook 路由

新增 `src/routes/api/webhooks/mailtrap/inbound.ts`：

- 仅接受 POST。
- 限制请求体大小，先验签再 JSON.parse。
- 原始 body 必须逐字节用于 HMAC，不能 parse 后重新序列化。
- 签名缺失或不匹配返回 401；结构合法但无需处理的事件返回 200。
- 对 Mailtrap 可重试故障返回 500；利用 `event_id` 和消息唯一约束保证重试不产生重复邮件。
- 不在日志中记录签名、Token、完整正文或完整 Webhook payload。

Mailtrap 文档说明失败投递每 5 分钟重试，最多 40 次；文档未规定时间戳新鲜度窗口，因此本期不自行增加可能导致合法重试失效的时间戳拒绝规则。

## 7. 前端设计

### 7.1 页面结构

桌面端使用左右等宽、贴合全屏的两个面板（不是悬浮 Card）：

- 页面：`min-h-dvh`，桌面 `h-dvh` + 双列网格，无外层间距；左面板 `bg-kumo-base`，右面板 `bg-kumo-recessed`。
- 移动端：上下单列，每个面板 `min-h-dvh`，页面可滚动，不强行把所有内容塞进一屏。
- 根页面标题、语言和描述使用 `SITE_NAME` 品牌名。
- 组件使用 Kumo 默认组件与语义 token：`InputGroup`、`Button`、`Badge`、`Banner`、`Empty`、`Text`、`InlineCopyText`、`Loader`；内容字号 14px，标题使用 heading；使用 ring 而不是边框 + 阴影，不自定义 raw color。

左侧面板：

- 品牌 `@SITE_NAME` 来自 `SITE_NAME` 环境配置。
- 内容在面板内垂直居中，隐私提醒使用 Kumo `Banner` 固定在底部。
- 邮箱前缀使用 Kumo `InputGroup`（可见 label、描述、错误与固定 `@domain.name` 后缀），主按钮在下方全宽展示。
- 空闲/过期时按钮为“开始收件”，创建中显示加载状态并防止重复提交；活动时表单保持可见、前缀只读，按钮变为“停止收件”。
- 活动时在表单下方显示 Kumo `Badge` 状态与剩余有效时间。

右侧面板状态机：

1. `idle`：Kumo `Empty` + 大 `@` 图标，不发起轮询。
2. `creating`：`Empty` + `Loader`，显示“正在准备地址”。
3. `listening-empty`：顶部显示“收件箱”、可复制地址与状态 `Badge`，中间使用 `Empty` 提示等待邮件。
4. `listening-list`：邮件按时间倒序显示为白底 ring surface 行，主题 + 绝对时间，第二行为发件人与摘要。
5. `message-detail`：在右侧面板内打开正文，可返回列表；保留列表上下文。
6. `reconnecting`：临时网络错误时保留当前内容并提示，将在前台自动重试。
7. `expired`：停止轮询，隐藏旧邮件，提示重新开始。

### 7.2 TanStack Query 行为

- Query key 包含规范化完整地址。
- 仅当地址存在、页面 `visibilityState === "visible"` 且浏览器在线时启用约 10 秒轮询。
- 页面隐藏或离线时停止；恢复可见后立即检查一次，而不是假定原会话仍有效。
- 创建成功后更新 Query cache；收到 `expired` 后清除当前邮件缓存并禁用查询。
- 组件卸载时清理状态，不用后台轮询维持匿名邮箱。
- `sessionStorage` 恢复失败或已过期时安静回到初始状态，不显示历史正文。

### 7.3 邮件正文安全

- 优先提供纯文本视图，保留换行并将链接识别为安全的可点击链接。
- 若支持 HTML 视图，必须先用严格 allowlist 清理 HTML，再置于无脚本权限的 sandboxed iframe；禁止脚本、表单、自动导航和危险 URL。
- 远程图片默认不自动加载，避免跟踪与隐私泄露。
- 不允许把 Mailtrap 返回的 `html_body` 直接通过 `dangerouslySetInnerHTML` 渲染。

### 7.4 Kumo UI 与可访问性

- 使用 Kumo v2 npm 包（`kumo init` 仅用于 block 复制，本页不需要）；先查询官方 registry/CLI 文档，再使用实际存在的 `InputGroup`、`Button`、`Badge`、`Banner`、`Empty`、`Text`、`InlineCopyText`、`Loader` 等默认导出组件。
- 遵循 kumo-design 约束：内容文字 14px、仅标题使用更大字号；不使用 `tracking-*` 或 `font-bold`；使用 Kumo semantic tokens；用 ring surface 替代自定义边框 + 阴影；不使用 raw color。
- 不猜测组件 props 或 variant；布局与动画使用 Tailwind 和 Kumo semantic tokens。
- 仅安装本页需要的组件，避免引入完整后台模板。
- 支持键盘操作、清晰 focus 状态、屏幕阅读器状态播报和 `prefers-reduced-motion`。
- 等待动画不依赖持续闪烁，新邮件到达有文字状态变化。

## 8. 数据库与依赖调整

1. 添加 `@libsql/client`，Drizzle 改用 `drizzle-orm/libsql`。
2. `DATABASE_URL` 生产指向 Turso，`DATABASE_AUTH_TOKEN` 保存 Turso Token；本地可用 libSQL 支持的本地文件 URL 进行开发。
3. 更新 `drizzle.config.ts` 的 `authToken` 配置，并保留 `.env.local` 优先加载。
4. 用新的 mailbox/message/webhook schema 替换 starter 的 `todos` 示例表，生成并检查迁移。
5. 确认无其他引用后移除 `better-sqlite3` 与对应类型依赖，避免两套 SQLite 驱动并存。
6. 保留现有 Better Auth 占位配置，不接入匿名邮箱流程；登录与永久邮箱以后单独设计。
7. 安装 Kumo UI 与正文清理所需的最小依赖，所有安装和脚本统一使用 `bun`/`bunx`。

## 9. 环境变量

在 `.env.example` 只写变量名和非敏感示例，实际密钥仅放 `.env.local` 或部署平台 Secret：

```dotenv
DATABASE_URL=file:local.db
DATABASE_AUTH_TOKEN=
SITE_NAME=ASTMS
MAILBOX_DOMAIN=domain.name
MAILBOX_TTL_SECONDS=90
MAILTRAP_API_TOKEN=
MAILTRAP_INBOX_ID=
MAILTRAP_WEBHOOK_SIGNING_SECRET=
CRON_SECRET=
```

- 生产将 `DATABASE_URL` 替换为 Turso URL，并配置 `DATABASE_AUTH_TOKEN`。
- `folder_id` 和 `domain_id` 不需要加入本期运行配置。
- 启动时校验服务端必需环境变量，缺失时给出明确服务端错误，但不要把 Secret 值打印出来。

## 10. 实施顺序

### 阶段 1：基础设施

- 初始化 Kumo UI，确认组件 API。
- 切换 libSQL/Turso，建立三张表、索引、外键与迁移。
- 增加环境变量校验和服务端配置模块。
- 验证开发环境数据库读写与生产 Turso 连接。

### 阶段 2：邮箱生命周期

- 实现前缀校验、随机地址、并发冲突处理。
- 实现创建、公开查询、前台轮询续期、过期与清理。
- 为生命周期编写单元/集成测试，重点覆盖“过期地址重新创建不继承旧邮件”。

### 阶段 3：Mailtrap 收件链路

- 实现类型安全的单邮件 API 客户端。
- 实现原始 body 验签、事件幂等、收件人匹配、事务入库与重试语义。
- 用用户提供的 Webhook 示例和邮件详情响应 fixture 完成本地测试。
- 通过 HTTPS tunnel 配置开发 Webhook，发送真实邮件验证完整链路。

### 阶段 4：双面板页面

- 完成桌面双面板与移动端单栏布局。
- 接入创建 mutation、前台可见性轮询和所有右侧状态。
- 完成邮件列表、详情、安全正文展示、复制地址和错误/过期反馈。
- 在真实浏览器验证完整流程及回归，而不只依赖类型检查。

### 阶段 5：上线准备

- 配置生产 Turso、Mailtrap Webhook URL 与 Secret。
- 配置过期清理定时任务。
- 检查公开访问提示、速率限制、安全响应头与日志脱敏。
- 执行真实域名端到端验收。

## 11. 测试与验收标准

### 11.1 自动化测试

- 前缀：空值随机生成、大小写规范化、非法字符、长度边界、有效地址直接打开、并发创建不重复。
- 生命周期：有效轮询续期、后台不续期、过期后不可读、过期重建不继承旧邮件。
- Webhook：正确签名、错误签名、缺失签名、原始 body 验签、 malformed JSON、非目标事件、错误 Inbox。
- 幂等：相同 `event_id` 重试不重复；不同事件重复通知同一 `message_id` 不重复。
- 收件：无匹配地址确认忽略、过期地址忽略、一封邮件匹配多个地址、Mailtrap 故障返回可重试错误。
- 安全：HTML 脚本/危险链接被移除，Token/签名不出现在客户端响应和日志。

### 11.2 浏览器验收

- 桌面端两个 Card 占满主要视区，移动端无横向溢出。
- 自定义前缀与空白随机前缀均可创建，非法输入有明确反馈；重复输入仍有效的地址可直接打开。
- 点击前右侧只有初始等待动画；点击后进入等待接入邮件状态。
- 真实发送到 `prefix@domain` 后，邮件在一个轮询周期附近出现，发件人、主题、时间和正文正确。
- 页面切到后台后停止请求；超过 TTL 再回来不会恢复旧邮件。
- 知道地址可读取有效邮箱；过期后使用同地址也无法读取历史邮件。
- 刷新可恢复尚未过期的当前状态；关闭页面后不会无限续期。
- 临时断网显示重连状态，恢复后在未过期情况下继续收件。
- 键盘、减少动态效果设置与基础屏幕阅读器状态提示可用。

### 11.3 工程检查

使用 Bun 执行并通过：

```bash
bun run lint
bun run check
bun run build
```

同时检查 Drizzle 迁移可重复应用、生产构建不包含 Mailtrap/Turso Secret，并记录一次真实 Mailtrap 端到端验证结果。

## 12. 后续待办

- 登录、注册与用户中心。
- 登录用户邮箱永久保留，以及匿名邮箱认领/迁移到账号的规则。
- 发件、回复、转发与域名发信配置。
- 管理员后台、审计、滥用处理和服务状态监控。
- 附件安全扫描与下载、原始邮件查看。
- 多域名、多 Inbox、邮件线程与更完整的留存策略。

## 13. 参考文档

- Mailtrap 文档索引：https://docs.mailtrap.io/llms.txt
- Inbound Webhooks：https://docs.mailtrap.io/inbound-email/webhooks.md
- 获取单封邮件：https://docs.mailtrap.io/developers/inbound/messages/get-a-message.md
- Kumo UI registry：https://kumo-ui.com/registry.md
- Kumo UI CLI：https://kumo-ui.com/cli.md

## 14. 落地情况回写（2026-10-27）

> 状态更新：MVP 已在本地实现并通过类型检查、lint、测试、生产构建与浏览器验收；真实 Mailtrap 端到端验证待填入线上凭据与 HTTPS tunnel 后执行。

### 14.1 已完成

**基础设施**

- 依赖：新增 `@libsql/client`、`@cloudflare/kumo`、`@phosphor-icons/react`、`zod`、`sanitize-html`、`@types/bun`；移除 `better-sqlite3` 与 `@types/better-sqlite3`。
- `src/db/index.ts` 改用 libSQL；`.env.local` 使用 `file:local.db`；`drizzle.config.ts` 使用 `turso` dialect + `authToken`，并优先加载 `.env.local`。
- `src/db/schema.ts`：`mailboxes` / `messages` / `webhook_receipts`，包含部分唯一索引、地址 + ended_at 索引、expires_at 索引、消息唯一约束与外键级联。
- 迁移：`drizzle/0000_cynical_squadron_supreme.sql` 已生成并重复应用成功。
- `src/server/config.ts`：域名、TTL、轮询间隔、Mailtrap、Cron 配置校验；缺失或非法时只报告变量名。
- `src/start.ts`：首次请求校验配置、CSRF（仅 server functions）、安全响应头（nosniff / no-referrer / DENY / Permissions-Policy / 最小 CSP）。
- `.env.example` 已补齐；`.env.local` 保留本地占位 Mailtrap 值。

**邮箱生命周期**

- `src/features/mailbox/address.ts`：trim/小写、6–32 位校验、Web Crypto 随机 10–12 位前缀、完整地址与收件人规范化。
- `src/features/mailbox/mailbox-service.ts`：事务内结束过期记录 → 复用有效地址或创建；部分唯一索引兜底并发；轮询事务续期；过期快照不返回历史邮件；清理函数。
- `src/server/write-lock.ts`：本地 libSQL 单连接写锁，避免 `TRANSACTION_ACTIVE`；Turso 多实例仍由唯一索引兜底。
- Server Functions：`getMailboxPublicConfig` / `createMailbox` / `getMailboxSnapshot`，含内存速率限制（20 次/分钟/IP）。
- 创建时顺带执行小批量清理。

**Mailtrap 链路**

- `src/features/mailtrap/client.ts`：固定 base URL、Bearer、10s 超时、401/403/404 永久失败与 429/5xx/网络可重试、响应 zod 校验。
- `src/features/mailtrap/signature.ts`：原始 body HMAC-SHA256 十六进制、常量时间比较。
- `src/features/mailtrap/sanitize.ts`：严格 allowlist，移除脚本/表单/iframe/img/style/危险 URL；`a` 添加 rel。
- `src/features/mailtrap/webhook-service.ts`：`inbound.message_received`、inbox 匹配、event_id 幂等、收件人匹配、事务写消息 + 回执、永久失败确认忽略、可重试失败 500。
- 路由 `/api/webhooks/mailtrap/inbound`：仅 POST、1 MiB 流式限体、验签后解析、其他方法 405。
- 路由 `/api/internal/cleanup`：POST + `CRON_SECRET` 常量时间校验，清理过期邮箱/邮件/回执。

**前端**

- Kumo UI 样式接入 `src/styles.css`（Kumo tokens 先于 Tailwind，`@source` 扫描 Kumo dist）；按需 granular imports。
- 首页保留参考图的全屏左右分栏结构，但控件与视觉使用 Kumo 默认设计体系：左侧 `bg-kumo-base` 表单与底部 `Banner` 隐私提醒，右侧 `bg-kumo-recessed` 收件区；移动端上下单列。
- 新增 `SITE_NAME` 配置并在左侧显示 `@SITE_NAME` 品牌名，页面标题与描述同步使用该名称。
- 活动时左侧表单保持可见，前缀只读，按钮切换为“停止收件”；右侧地址支持点击复制。
- 右侧使用 Kumo `Empty`、`Badge`、`Banner`、`InlineCopyText`、`Text` 呈现 idle / creating / listening-empty / list / detail / reconnecting / expired 全状态；内容字号统一 14px，使用语义色 token 与 ring surface。
- TanStack Query：地址维度 query key、可见性 + 在线 + 页面存在才轮询、10s 间隔、失败保留旧内容、过期清缓存、sessionStorage 仅用于刷新恢复、恢复失败或过期静默回 idle。
- 新邮件 aria-live 播报；`prefers-reduced-motion` 下关闭等待动画；键盘可操作、列表按钮 focus ring。
- 邮件正文：默认纯文本 + 安全链接；HTML 使用服务端净化的 `srcDoc` + `sandbox=""` + CSP，远程图片阻止加载。
- 地址公开提示、更换地址、重新开始、复制反馈均已接入。

### 14.2 验证结果

- `bun test`：49 pass / 0 fail（地址、生命周期、并发、过期重建、Webhook 验签/幂等/多收件人/失败重试、HTML 净化、Mailtrap 客户端）。
- `bun run lint`：通过。
- `bun run check`：通过。
- `bunx tsc --noEmit`：通过。
- `bun run build`：通过（Nitro node-server）。
- `bun run db:migrate`：重复执行成功。
- 生产构建产物检查：`.output/public` 未出现 `MAILTRAP_*`、`CRON_SECRET`、`DATABASE_URL`、`createHmac`、`sanitize-html` 等服务端内容。
- 浏览器验收（约 1163px 全屏双栏 / 820px 单栏）：
  - 左 `bg-kumo-base`、右 `bg-kumo-recessed` 全屏分栏贴合视口；移动宽度无横向溢出。
  - 非法前缀显示错误；自定义前缀、空前缀随机地址、相同有效地址再次打开均通过。
  - 创建后右侧进入等待邮件；10 秒轮询生效；新邮件列表/详情/HTML 净化/返回列表正常。
  - 页面隐藏后停止轮询（`last_seen_at` 不再更新）；超过 TTL 恢复可见后显示过期、旧邮件隐藏。
  - 刷新可恢复未过期的地址；过期后的恢复静默回到 idle。
  - 离线显示“网络已断开/已暂停”，恢复在线后继续收件并保留内容。
  - 已配置 aria-live 状态播报；复制按钮因自动化浏览器拒绝剪贴板权限未能验证成功提示，Kumo ClipboardText 逻辑本身正常。
- 接口验证：
  - 页面响应包含安全响应头。
  - `/api/internal/cleanup`：错误 secret 401、正确 secret 200、GET 405。
  - `/api/webhooks/mailtrap/inbound`：错误签名 401、GET 405、合法签名 + malformed JSON 400。
  - 服务端函数跨站 Origin / 无 Origin 请求 403（CSRF 生效）。

### 14.3 未完成 / 需部署配置

- **真实 Mailtrap 端到端未执行**：当前 `.env.local` 的 `MAILTRAP_API_TOKEN` / `MAILTRAP_INBOX_ID` / `MAILTRAP_WEBHOOK_SIGNING_SECRET` 为本地占位值，且没有 HTTPS tunnel。已通过真实 `handleMailtrapWebhook` 处理链路 + 注入的邮件详情完成两封模拟邮件验收（含签名、幂等、入库、轮询展示、HTML 净化）。上线前需填入真实值、配置 Webhook URL，并记录一次真实投递结果。
- **MAILBOX_DOMAIN**：当前为 `domain.name` 占位，需替换为已绑定 catch-all 的真实域名。
- **Turso**：生产需配置真实 `DATABASE_URL` 与 `DATABASE_AUTH_TOKEN`，并执行 `bun run db:migrate`。
- **定时清理**：`/api/internal/cleanup` 已就绪，但尚未在部署平台配置每 5 分钟 POST 调用；需配置 `CRON_SECRET`。
- **环境变量启动校验**：实现为 `src/start.ts` 请求中间件在首个请求时校验并缓存结果，而非 Nitro 进程 boot 时；配置错误时首个页面请求即返回明确服务端错误。
- **Kumo CLI init**：未执行 `kumo init`，因为 v2 组件为 npm 包导出，`init` 仅用于 block 复制；已先查询官方 registry/CLI 文档并使用 granular imports。
- **速率限制**：为单进程内存实现且信任 `x-forwarded-for`；生产需部署在可信代理后，多实例时建议改为共享存储。
- **HTML 存储**：入库的 `html_body` 为服务器净化后的内容，不保留原始 HTML；纯文本正文原样保存。
- **BETTER_AUTH_SECRET**：本地已生成占位 secret；生产部署前必须设置，否则 Better Auth 占位模块会报默认 secret 错误（匿名邮箱不使用它）。
- **移动端真机/窄屏**：浏览器验收覆盖约 820px 单栏与 1172px 双栏，未在 375px 真机复测；布局使用 `grid-cols-1` + 流式宽度，无固定宽度。
