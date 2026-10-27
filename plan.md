# ASTMS 临时邮箱 MVP 实施计划

> ASTMS — A simple temporary mailbox service  
> 日期：2026-10-27  
> 状态：MVP 已落地并通过本地工程/浏览器验收；真实 Mailtrap 端到端待配置凭据；用户后台开发计划见第 15 节

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
- Webhook Signing Secret 由 Mailtrap 在创建 Webhook 后自动生成，需在 Webhook 详情中复制并填入 `MAILTRAP_WEBHOOK_SIGNING_SECRET`；Mailtrap 后台不支持填写自定义 Secret。
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
- 空前缀使用加密安全随机源，从 30 个名、30 个姓中随机组合，生成「名-姓+随机三位数」前缀（如 `tom-holland150`）。
- 同一时刻同一地址只能对应一个有效邮箱。
- 对仍有效的相同地址点击“开始收件”时直接打开现有邮箱，而不是报冲突；任意前台查看者都可读取并续期，这与公开访问模型一致。
- 过期地址允许再次创建；新邮箱使用新的内部 ID，不继承旧邮件。
- 邮件查询以完整地址为公开访问条件，不添加匿名账号、访问令牌或 HttpOnly 会话。
- 页面显示：“知道此地址的人都能查看邮件，请勿用于敏感信息；页面离开前台后地址将很快失效。”

## 3. 明确不做

以下功能不进入本次实现：

- 发件、回复、转发。
- 注册、登录、用户中心（不在 MVP；已由第 15 节排期，仅第三方登录、不做注册）。
- 登录用户邮箱永久保留（不在 MVP；已由第 15 节排期）。
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

- 登录、注册与用户中心（已排期：见第 15 节；本期仅第三方登录，不做注册）。
- 登录用户固定邮箱（已排期：见第 15 节）；匿名邮箱认领/迁移仍待设计。
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

- `src/features/mailbox/address.ts`：trim/小写、6–32 位校验、Web Crypto 随机「名-姓+三位数」前缀、完整地址与收件人规范化。
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

## 15. 用户后台开发计划（第三方登录 + 固定邮箱）

> 规划日期：2026-10-27  
> 状态：方案已确认，待实施  
> 范围说明：本节覆盖原第 3 节中暂缓的登录与用户中心能力；匿名临时邮箱的既有行为和验收结论保持不变。

### 15.1 本期目标

1. 默认只允许第三方账号登录：GitHub、Google、SB.SB 论坛（标准 OIDC）；本地验收可通过 `EMAIL_PASS_LOGIN` 临时开启邮箱密码登录，默认关闭。
2. 登录用户在独立后台 `/dashboard` 中最多保留 **50 个固定临时邮箱**。
3. 固定邮箱长期保留、始终可收信（除非达到上限被淘汰）；创建第 51 个时自动淘汰最久未打开的邮箱。
4. 固定邮箱仅登录者本人可读取；地址可以公开分享用于收信。
5. 固定邮箱前缀最小 3 位，点号不影响投递：前缀 `abc` 也能收到发往 `a.b.c@domain` 的邮件。
6. 首页左侧区域右上角放置登录入口，点击打开登录弹窗；登录成功进入 `/dashboard`。
7. 匿名临时邮箱流程保持现状，与固定邮箱使用两套独立的生命周期和访问规则。

### 15.2 已确认决策

| 决策项           | 结论                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| 后台形态         | 独立 `/dashboard`，左侧固定邮箱列表 + 右侧收件箱                                                                |
| 登录方式         | 默认仅 GitHub、Google、SB.SB；可用 `EMAIL_PASS_LOGIN` 显式开启邮箱密码登录（首次登录自动注册），默认关闭        |
| 首页入口         | 左侧面板右上角；未登录显示“登录”，已登录显示头像 + “进入后台”                                                   |
| 登录交互         | 首页内 Kumo Dialog；默认列出三个提供方，开启 `EMAIL_PASS_LOGIN` 时额外显示邮箱密码表单；成功后进入 `/dashboard` |
| 固定邮箱上限     | 每用户最多 50 个；满额新建时自动淘汰最久未打开的邮箱                                                            |
| 固定邮箱生命周期 | 永久保留，除非用户手动删除或被上限淘汰；不再有过期倒计时                                                        |
| 固定邮箱访问     | 仅本人登录态可读；仅知道地址不能查看                                                                            |
| 点号规则         | 仅固定邮箱忽略点号；匿名邮箱保持严格地址匹配                                                                    |
| 固定邮箱前缀     | 最小 3 位、最大 32 位；点号在规范化时移除                                                                       |
| 匿名邮箱前缀     | 维持现有 6–32 位、禁止点号                                                                                      |
| 地址冲突         | 登录用户创建固定邮箱时，如果地址正被匿名邮箱占用，拒绝创建并提示                                                |
| 账号合并         | 始终不合并；同一自然人在不同 provider 下是不同用户                                                              |
| SB.SB email      | 不申请 `email` scope；使用 `sub` 生成内部占位邮箱，界面不展示                                                   |

### 15.3 认证方案（Better Auth）

#### 15.3.1 基础配置

- 复用已安装的 `better-auth`（当前解析版本 1.7.14；实施前锁定版本并核对 API）。
- 使用 `drizzleAdapter(db, { provider: 'sqlite', schema })`，与现有 libSQL/Turso 数据库共用。
- `emailAndPassword.enabled` 默认 false；仅当 `EMAIL_PASS_LOGIN=1|true` 时开启邮箱密码登录（首次登录自动注册，无邮箱验证/找回密码）。
- `account.accountLinking.enabled: false`，不做跨 provider 账号合并。
- `account.encryptOAuthTokens: true`，加密数据库中的 OAuth access/refresh/id token。
- `advanced.ipAddress.disableIpTracking: true`，会话表不保存 IP。
- `tanstackStartCookies()` 必须是最后一个插件。
- `getAuth()` 只放在 `src/lib/auth.ts`；`getRequestHeaders()`、`getAuth()`、数据库读取等 server-only 逻辑放在 `auth-server.ts`，客户端只通过 `createServerFn` RPC 调用。
- 认证配置拆成纯函数 `createAuthOptions()` + 懒加载单例 `getAuth()`：
  - 缺少认证环境变量时，匿名首页仍可正常使用；
  - `/api/auth/*` 或登录按钮才返回“登录暂未开放”；
  - auth schema 已按 Better Auth 1.7.14 的 `getAuthTables` 手动落地；后续升级时用 CLI 生成并比对。

示意配置：

```ts
const baseURL = process.env.BETTER_AUTH_URL

export const authOptions = {
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: isEmailPasswordLoginEnabled() },
  account: {
    accountLinking: { enabled: false },
    encryptOAuthTokens: true,
  },
  advanced: { ipAddress: { disableIpTracking: true } },
  socialProviders: {
    github: {/* 仅当 GITHUB_* 成对存在时注册 */},
    google: {/* 仅当 GOOGLE_* 成对存在时注册 */},
  },
  plugins: [
    genericOAuth({ config: [sbConfig] }), // 仅当 SB_OIDC_* 配置完整时注册
    tanstackStartCookies(), // 必须最后
  ],
}
```

#### 15.3.2 Provider 与回调地址

| Provider | Better Auth providerId | Scope                           | 回调路径                    |
| -------- | ---------------------- | ------------------------------- | --------------------------- |
| GitHub   | `github`               | Better Auth 默认                | `/api/auth/callback/github` |
| Google   | `google`               | Better Auth 默认                | `/api/auth/callback/google` |
| SB.SB    | `sb`                   | `openid profile offline_access` | `/api/auth/callback/sb`     |

生产环境回调地址：

- `https://vip.co.fo/api/auth/callback/github`
- `https://vip.co.fo/api/auth/callback/google`
- `https://vip.co.fo/api/auth/callback/sb`（用户已提供）

#### 15.3.3 SB.SB OIDC 接入

使用 Better Auth `genericOAuth` 插件，配置：

```ts
{
  providerId: 'sb',
  name: 'SB.SB',
  discoveryUrl: 'https://sb.sb/oidc/.well-known/openid-configuration',
  clientId: process.env.SB_OIDC_CLIENT_ID!,
  clientSecret: process.env.SB_OIDC_CLIENT_SECRET!,
  scopes: ['openid', 'profile', 'offline_access'],
  redirectURI: `${baseURL}/api/auth/callback/sb`,
  pkce: true,          // S256
  responseType: 'code',
  disableProviderLogout: true, // 退出 ASTMS 不连带退出论坛
  mapProfileToUser: (profile) => ({
    // sub 可能包含邮箱 local part 不允许的字符，统一哈希后再拼接
    email: `sb-${sha256Hex(profile.sub).slice(0, 32)}@oauth.invalid`,
    emailVerified: false,
    name: profile.name ?? profile.preferred_username ?? 'SB.SB 用户',
    image: profile.picture,
  }),
}
```

已知端点（用于排查，正常走 discovery）：

- issuer：`https://sb.sb/oidc`
- authorization：`https://sb.sb/oidc/authorize`
- token：`https://sb.sb/oidc/token`
- userinfo：`https://sb.sb/oidc/userinfo`
- logout：`https://sb.sb/oidc/logout`
- jwks：`https://sb.sb/oidc/keys`
- introspection：`https://sb.sb/oidc/introspect`

说明：

- 按已确认决策不申请 `email` scope；Better Auth 要求 user 表有 email，因此用稳定的 `sub` 生成内部占位邮箱。
- 占位邮箱使用保留域 `.invalid`，不展示在界面，也不用于发信。
- 如果 SB.SB 的 userinfo 缺少 `sub`，登录失败关闭，不做猜测性回退。
- 当前按推荐 scope 请求 `offline_access`；本期登录后不调用论坛 API，refresh token 仅由 Better Auth 加密保存。若不需要，可在实施时去掉该 scope 以缩小令牌面。

#### 15.3.4 占位邮箱与“不合并”规则

三个 provider 都把 user 表 email 映射为内部唯一值。账号主体先做 SHA-256，取 32 位十六进制，避免 OIDC `sub` 中出现 `|`、`:` 等非法邮箱字符：

| Provider | 内部 email                                            |
| -------- | ----------------------------------------------------- |
| GitHub   | `github-<sha256(profile.id) 前 32 位>@oauth.invalid`  |
| Google   | `google-<sha256(profile.sub) 前 32 位>@oauth.invalid` |
| SB.SB    | `sb-<sha256(profile.sub) 前 32 位>@oauth.invalid`     |

- `emailVerified` 均为 `false`；不把真实第三方邮箱写入 user 表。
- 这样即使 GitHub 与 Google 返回同一个真实邮箱，也会创建两个独立用户，符合“始终不合并”。
- 优点：不会触发 Better Auth 的 `account not linked` 错误，也不会跨平台串号。
- 三个 provider 的映射都必须保证 `name` 非空：依次使用 `name`、用户名/`preferred_username`、固定文案；`image` 使用 provider 头像。
- 账号主体缺失或无法生成合法占位邮箱时登录失败关闭，不做猜测性回退。
- 可选开启 `overrideUserInfoOnSignIn: true`，每次登录刷新昵称/头像；不会改变内部占位邮箱。
- 界面只展示 `name` 和头像，不展示内部占位邮箱。

#### 15.3.5 会话与退出

- 继续使用现有 `/api/auth/$` catch-all 路由；改为懒加载 `getAuth()`，返回 `Cache-Control: no-store`。
- 会话 cookie 使用 Better Auth 默认安全属性：HttpOnly、SameSite=Lax、生产 Secure；不得改成 SameSite=Strict，否则 OAuth 回调会丢失 state cookie。
- 首期沿用 Better Auth 默认会话时长（7 天，活跃自动续期）；不额外配置长期会话。
- GitHub / Google / SB.SB 退出都只清理 ASTMS 本地会话；SB.SB 通过 `disableProviderLogout: true` 避免连带退出论坛。
- 会话过期或缺失时：
  - `/dashboard` 的 `beforeLoad` 重定向到 `/?login=true`；
  - 后端 Server Function 返回 `unauthenticated`，前端提示“登录已过期，请重新登录”。

### 15.4 数据模型变更

#### 15.4.1 Better Auth 表

按 Better Auth 1.7.14 的 `getAuthTables` 落地并审查以下表（单数表名、snake_case 列名；后续可用 CLI 复核）：

- `user`：id、name、email（唯一，内部占位）、emailVerified、image、createdAt、updatedAt。
- `session`：id、expiresAt、token、createdAt、updatedAt、ipAddress、userAgent、userId。
- `account`：id、accountId、providerId、userId、accessToken、refreshToken、idToken、过期时间、scope、createdAt、updatedAt。
- `verification`：当前无邮件验证流程，但保留生成表以兼容 Better Auth。

Drizzle 侧：

- 生成 `src/db/auth-schema.ts`，在 `src/db/schema.ts` 中 re-export，确保 `drizzle-kit` 能发现。
- `drizzleAdapter` 传入包含 auth 表的 `schema`。
- 重新运行 `bun run db:generate` 生成迁移，逐条审查 SQL。

#### 15.4.2 `mailboxes` 调整

| 字段           | 变更                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `user_id`      | 新增，text，可空，外键 `user.id`，`on delete cascade`                                                      |
| `expires_at`   | 保持 NOT NULL；固定邮箱写入远期哨兵 `FIXED_MAILBOX_EXPIRES_AT`（9999-12-31），避免 SQLite 改可空触发表重建 |
| `last_seen_at` | 保留；固定邮箱每次打开收件箱时更新，用于 LRU 淘汰                                                          |
| `ended_at`     | 保留给匿名邮箱；固定邮箱删除时直接硬删除                                                                   |

新增索引：

- `(user_id, ended_at)`：后台列表与归属查询。
- 现有 `ended_at IS NULL` 的 `address` 部分唯一索引继续覆盖匿名和固定邮箱，保证同一时刻全局地址唯一。

数据不变量：

- 匿名邮箱：`user_id IS NULL`，`expires_at` 为真实 TTL。
- 固定邮箱：`user_id IS NOT NULL`，`expires_at = FIXED_MAILBOX_EXPIRES_AT`，`ended_at IS NULL`。
- 所有匿名查询/清理必须显式过滤 `user_id IS NULL`，不能只依赖 `expires_at`。
- 地址活跃期间全局唯一，不区分匿名/固定。
- 删除固定邮箱时硬删除 `mailboxes` 行，`messages` 通过外键级联删除。

#### 15.4.3 迁移与兼容

- 新增迁移文件（`0001_*.sql`）只创建 auth 表、给 `mailboxes` 增加 `user_id` 与索引，不做表重建，风险较低。
- 仍需：
  1. 复制现有 `local.db` 做迁移演练；
  2. 确认现有匿名邮箱记录与邮件不丢失；
  3. Turso 生产迁移前先备份；
  4. 迁移后跑一遍匿名创建、轮询、过期、Webhook 测试。
- 固定邮箱使用远期 `expires_at` 哨兵，任何匿名读取/清理逻辑都必须显式过滤 `user_id IS NULL`；测试需覆盖“固定邮箱不会被匿名 TTL 逻辑过期或删除”。

### 15.5 地址规则与收件匹配

#### 15.5.1 固定邮箱前缀

规范化顺序：

1. trim、转小写；
2. 移除所有 `.`；
3. 校验长度 3–32；
4. 只允许 `a-z0-9-`，且必须以字母或数字开头和结尾。

示例：

| 输入      | 规范化结果 | 结果              |
| --------- | ---------- | ----------------- |
| `a.b.c`   | `abc`      | 合法              |
| `A.B.C`   | `abc`      | 合法              |
| `a.b`     | `ab`       | 拒绝（不足 3 位） |
| `.abc.`   | `abc`      | 合法              |
| `a..b..c` | `abc`      | 合法              |
| `ab-c`    | `ab-c`     | 合法              |
| `ab`      | `ab`       | 拒绝              |
| `a_b`     | `a_b`      | 拒绝（非法字符）  |

UI 在输入含点号时显示预览：“将创建 abc@domain”。匿名邮箱仍使用现有 6–32 位、禁止点号的规则。

#### 15.5.2 收件匹配矩阵

Webhook 收到收件人后：

- 匿名邮箱：使用规范化后的完整地址严格匹配，且必须未结束、未过期。
- 固定邮箱：移除收件地址 local part 中的所有点号，再与固定邮箱的 canonical 地址匹配，不检查 TTL。

| 收件地址       | 匿名 `abc@domain` | 固定 `abc@domain`     |
| -------------- | ----------------- | --------------------- |
| `abc@domain`   | 命中              | 命中                  |
| `a.b.c@domain` | 不命中            | 命中                  |
| `ab.c@domain`  | 不命中            | 命中（规范化为 abc）  |
| `A.B.C@domain` | 不命中            | 命中                  |
| `a.b@domain`   | 不命中            | 不命中（规范化为 ab） |

实现要点：

- 新增 `canonicalizeFixedAddress(address)`：只移除 local part 的点号，不动域名。
- Webhook 同时查两组：
  - 匿名：`address IN (原始收件地址)` + `user_id IS NULL` + `ended_at IS NULL` + `expires_at > now`；
  - 固定：`address IN (去点后的收件地址)` + `user_id IS NOT NULL` + `ended_at IS NULL`。
- 合并结果按 mailbox id 去重；同一封邮件可落入多个邮箱。
- 固定邮箱不要求用户在线：Webhook 始终入库，用户下次打开后台即可看到。
- 已删除/被淘汰的固定邮箱不匹配，邮件按无匹配地址忽略。

#### 15.5.3 创建冲突规则

| 目标地址当前状态       | 固定邮箱创建结果                             |
| ---------------------- | -------------------------------------------- |
| 当前用户自己的固定邮箱 | 直接打开现有邮箱，不新建、不淘汰             |
| 其他用户的固定邮箱     | 拒绝：地址暂不可用                           |
| 活跃的匿名邮箱         | 拒绝：地址暂不可用（不抢占、不拦截他人邮件） |
| 已过期的匿名邮箱       | 先结束该匿名记录，再创建固定邮箱             |
| 无活跃记录             | 创建固定邮箱                                 |

并发时由 `ended_at IS NULL` 的地址唯一索引兜底；冲突后重新查询归属并返回明确状态。

随机前缀（用户留空）使用“只新建、不打开已有”的语义：生成的前缀命中任何已有邮箱（包括自己的）时重试；只有显式输入前缀时才允许打开自己的同地址固定邮箱。

#### 15.5.4 50 个上限与 LRU 淘汰

- 所有创建、计数、淘汰、插入在同一个写事务中完成。
- 创建第 51 个时：
  1. 先确认目标地址可用；
  2. 选择当前用户 `last_seen_at` 最早、其次 `created_at` 最早的固定邮箱；
  3. 硬删除该邮箱及其邮件；
  4. 插入新邮箱；
  5. 返回 `evictedAddress` 供前端提示。
- 地址不可用时不淘汰任何邮箱。
- 用户打开某个固定邮箱时更新 `last_seen_at`；仅浏览列表不更新，避免所有邮箱同时变成“最近使用”。
- 后台列表按 `created_at DESC` 稳定排序，避免轮询时列表跳动；LRU 只用于淘汰。
- 页面必须明确提示满额自动淘汰规则，并在淘汰发生后显示具体地址的 Toast。

### 15.6 服务端接口

#### 15.6.1 认证

新增 `src/features/auth/auth-functions.ts`（仅 `createServerFn` 包装）+ `src/features/auth/auth-server.ts`（server-only 逻辑）：

- `getViewer`（GET）
  - 返回 `{ user: { id, name, image, provider } | null, authReady, providers, emailPasswordLogin }`。
  - `providers` 只包含已配置的 GitHub/Google/SB.SB 布尔值。
  - 认证配置缺失或会话查询失败时返回未登录状态，不让首页 loader 崩溃。
- 内部 `requireViewer()` 放在 `auth-server.ts`，供其他 Server Function 复用，统一从 `getRequestHeaders()` 读取会话。
- `src/routes/api/auth/$.ts` 对 `sign-in/email`、`sign-up/email`、`sign-in/social` 分别做 10/5/10 次每分钟的进程内 IP 限流（`auth-rate-limit.ts`）。
- 不向客户端返回真实/占位 email、access token 或 user agent。

#### 15.6.2 固定邮箱

新增 `src/features/mailbox/owned-mailbox-service.ts` + `owned-mailbox-functions.ts`：

- `listMyMailboxes`
  - 返回当前用户全部固定邮箱摘要：id、address、createdAt、lastSeenAt。
  - 最多 50 条，按 `created_at DESC`。
- `createMyMailbox({ prefix? })`
  - 校验固定前缀规则；空值使用现有随机姓名前缀生成器。
  - 处理冲突、50 上限与 LRU 淘汰。
  - 返回 `active | invalid_prefix | address_in_use | rate_limited | unauthenticated | unavailable`，成功时带 `mailbox`、`evictedAddress?`。
- `getMyMailboxSnapshot({ mailboxId })`
  - 必须登录且邮箱属于当前用户；不按地址查询。
  - 更新 `last_seen_at`，返回最近 200 封邮件。
  - 其他用户的 id 统一返回 `not_found`，不泄露存在性。
- `deleteMyMailbox({ mailboxId })`
  - 仅本人可删；硬删除并级联删除邮件。
  - 返回 `deleted | not_found | unauthenticated`。
- 创建与删除增加按用户 ID 的内存速率限制（建议 10 次/分钟/用户），与现有 IP 限流并存。

`getMailboxPublicConfig` 继续提供域名、轮询间隔和匿名前缀规则；后台创建表单使用域名与 3 位固定前缀规则。

#### 15.6.3 匿名邮箱回归

以下函数必须加 `user_id IS NULL` 过滤，避免匿名访问面读到固定邮箱：

- `readMailboxSnapshot`
- `readMailboxPeek`
- 匿名创建/打开地址的查询
- 清理过期邮箱

匿名创建遇到固定邮箱占用的地址时返回 `address_in_use`，不得返回固定邮箱的 `mailboxId` 或 `joinedExisting`。

#### 15.6.4 Webhook 与清理

- `handleMailtrapWebhook` 改为“匿名严格匹配 + 固定去点匹配”两组查询，按上节规则合并去重。
- 固定邮箱不检查在线状态和 TTL；匿名邮箱继续检查 `expires_at > now`。
- 保持现有 `event_id` 幂等、`(mailbox_id, mailtrap_message_id)` 唯一约束和事务语义。
- 清理任务只结束/删除匿名邮箱；固定邮箱永不参与 TTL 清理。
- 可在清理任务中顺带删除过期 Better Auth 会话（可选，不影响固定邮箱）。

### 15.7 前端设计

#### 15.7.1 首页登录入口与弹窗

- `CreateMailboxPane` 增加 `topRightAction` 插槽，在左侧面板右上角渲染登录入口；不改变现有居中表单结构。
- 未登录：显示“登录”按钮（Kumo `Button` secondary/sm），点击打开 `LoginDialog`。
- 已登录：显示头像 + “进入后台”；点击导航到 `/dashboard`。
- 如果已登录且 URL 带 `login=true`，直接导航到 `/dashboard`，不展示 provider 选择，避免误建第二个账号。
- 首页路由 `validateSearch` 支持 `login=true`、`error`、`error_description`，用于从 `/dashboard` 未登录重定向后自动打开弹窗并展示 OAuth 错误；关闭弹窗时清理 query。
- `LoginDialog`：
  - Kumo Dialog，标题“登录”，说明“使用第三方账号或邮箱密码登录，管理你的固定邮箱”。
  - 只显示服务端已配置的 provider：GitHub、Google、SB.SB；每个按钮带图标与 loading 状态。
  - `EMAIL_PASS_LOGIN` 开启时额外显示邮箱 + 密码表单；首次登录自动注册，密码 8–128 位，不提供找回密码。
  - 点击调用 `authClient.signIn.social({ provider, callbackURL: '/dashboard', errorCallbackURL: '/?login=true' })`。
  - 没有任何可用登录方式时显示 Banner：“登录暂未开放”。
  - 错误 query（如 `access_denied`）在首页以 Toast 提示，并清理 URL。
  - 错误只映射为固定中文文案（取消、网络失败、登录失败、暂未开放），不回显 provider 原始错误描述。
  - 隐私提示：“仅用于登录；不保存第三方密码，不展示第三方邮箱。”开启邮箱密码时，密码仅用于本站登录。
- 已登录用户在首页仍创建匿名邮箱；表单下方提示“首页创建的是临时地址，固定邮箱请在后台创建”。

#### 15.7.2 `/dashboard` 页面

路由与守卫：

- 新增 `src/routes/dashboard.tsx`。
- `beforeLoad` 调用 `getViewer`；未登录重定向到 `/?login=true`。
- `validateSearch` 支持 `mailbox=<id>`，用于刷新/深链保持选中邮箱。
- `loader` 并行获取 viewer、邮箱列表、公开配置；列表作为 TanStack Query 的 `initialData`。

布局：

- 桌面：`lg:grid lg:h-dvh lg:grid-cols-[minmax(280px,340px)_1fr]`，左侧 `bg-kumo-base`，右侧 `bg-kumo-recessed`。
- 移动：单列，左侧列表与右侧收件箱各自 `min-h-dvh`；选择邮箱后滚动到收件箱。
- 左栏：
  - 顶部：品牌、用户头像/名称、返回首页与退出登录按钮（直接按钮，避免 Kumo DropdownMenu 的 MenuGroup 上下文限制）。
  - 创建表单：Kumo `InputGroup`，固定 `@domain` 后缀，点号预览提示，按钮“创建固定邮箱”。
  - 配额：`已用 N / 50` Badge；满额提示“新建会自动删除最久未打开的邮箱”。
  - 邮箱列表：地址、创建时间/最近打开时间、复制按钮、删除按钮；选中项使用 ring/brand 状态。
  - 底部隐私 Banner：“固定邮箱只有你能查看；地址可分享给任何人用于收信。”
- 右栏：
  - 未选择邮箱：Empty “创建或选择一个固定邮箱”。
  - 已选择：地址 + “固定邮箱” Badge + 复制；状态 Badge（收件中/已暂停/重连中）；旁注“不会过期，满 50 个后新建会自动淘汰最久未打开的一个”。
  - 邮件列表与详情复用现有 `MessageDetail` / 正文安全渲染逻辑。
  - 空收件箱：Empty “等待邮件”，说明“邮件会一直保留，关闭页面也不会丢失”。
  - 断网显示暂停 Banner；恢复后立即刷新。
  - 选中邮箱被删除或淘汰时，提示并自动选择下一个；没有剩余邮箱则回到 Empty。
- 删除确认：Kumo Dialog，明确“地址与全部邮件将立即删除，无法恢复”。
- 创建成功：自动复制地址、选中新邮箱、Toast；如发生淘汰，追加 warning Toast 显示被删除地址。
- 轮询：仅在选中邮箱、页面可见、浏览器在线时每 10 秒刷新；隐藏页面停止轮询，但邮件仍由 Webhook 入库。

#### 15.7.3 组件与文件规划

```text
src/features/auth/
  auth-functions.ts       # 仅 createServerFn 包装
  auth-server.ts          # server-only：session、provider、requireViewer
  auth-rate-limit.ts      # 认证入口 IP 限流
  auth-providers.ts
  components/login-dialog.tsx
  components/auth-entry.tsx

src/features/mailbox/
  owned-mailbox-service.ts
  owned-mailbox-functions.ts
  components/dashboard-sidebar.tsx
  components/dashboard-inbox-pane.tsx
  components/create-fixed-mailbox-form.tsx
  components/message-list.tsx      # 从 inbox-pane 抽出
  components/message-detail.tsx    # 从 inbox-pane 抽出

src/routes/dashboard.tsx
src/db/auth-schema.ts              # 按 getAuthTables 落地，可用 CLI 复核
```

- 抽取 `MessageList` / `MessageDetail`，匿名收件箱和固定收件箱共用，避免复制正文安全逻辑。
- 复用 `MessageBody`、`formatAbsoluteTime`、`formatSender`、`messagePreview`。
- 删除未使用的 `src/integrations/better-auth/header-user.tsx` 占位组件，避免旧的 email/password 逻辑残留。
- Kumo UI 约束保持不变：内容 14px、标题 heading、语义 token、ring surface、无 raw color、不使用 `tracking-*`/`font-bold`。
- 时间显示统一使用 `Asia/Shanghai`，避免 SSR 与客户端时区不同导致 hydration mismatch。
- 对话框、按钮、Badge、Empty、Banner、InlineCopyText、Loader 均使用 Kumo 默认组件；实现前先查 registry 确认 Dialog/Dropdown API。
- 可访问性：对话框焦点管理、列表项独立复制/删除按钮的 aria-label、aria-live 新邮件播报、键盘操作、`prefers-reduced-motion`。

### 15.8 安全与隐私

- **归属鉴权**：所有固定邮箱操作只接受会话中的 userId；不接收客户端传入的 userId。按 mailboxId 查询时校验归属，其他用户统一 `not_found`。
- **匿名面隔离**：匿名快照/peek/创建必须过滤 `user_id IS NULL`；固定邮箱不能通过“知道地址”读取。
- **默认无密码面**：默认不启用 email/password；只有显式设置 `EMAIL_PASS_LOGIN=1|true` 才显示邮箱密码登录，且无邮箱验证/找回密码。生产默认保持关闭。
- **服务端隔离**：`getViewer` 只通过 `createServerFn` RPC 暴露；`getRequestHeaders`、`getAuth`、数据库读取放在 `auth-server.ts`，避免客户端 bundle 引入服务端模块。
- **认证限流**：`/api/auth` 的邮箱登录、注册、三方登录入口按 IP 限流；与匿名创建、固定邮箱操作的内存限流一致。
- **账号隔离**：三个 provider 使用内部占位邮箱，同一真实邮箱不会合并账号。
- **令牌保护**：OAuth token 加密存储；不写入浏览器 localStorage；服务端日志不记录 token、secret、完整邮件正文。
- **Cookie/CSRF**：HttpOnly + SameSite=Lax + 生产 Secure；OAuth state + PKCE；Server Function 继续使用现有 Origin 校验。
- **速率限制**：匿名创建按 IP；固定邮箱创建/删除按用户；认证入口按 IP（10/5/10 次每分钟）。
- **会话切换**：退出登录或检测到 `unauthenticated` 时，清空 TanStack Query 的 `my-mailboxes` / `my-mailbox-snapshot` 缓存与选中状态，避免同一浏览器切换账号后短暂看到上一个用户的数据。
- **头像资源**：头像来自第三方域名；如果后续收紧 CSP，需要为 GitHub/Google/SB.SB 头像域添加 `img-src`，或改为首字母头像。
- **破坏性操作**：50 上限自动淘汰、手动删除都必须有明确文案；淘汰后 Toast 显示被删地址。
- **隐私文案**：登录弹窗说明只保存第三方公开资料；后台 Banner 说明固定邮箱仅本人可读；匿名 Banner 保持不变。
- **数据留存**：固定邮箱与邮件永久保留至删除/淘汰；首期邮件列表最多返回最近 200 封，避免单次响应过大，界面需标注上限。
- **不做匿名认领**：匿名邮箱不能在登录后“认领”为固定邮箱，避免地址归属与历史邮件泄露争议。

### 15.9 环境变量与部署

#### 15.9.1 新增环境变量

```dotenv
# Better Auth
BETTER_AUTH_URL=https://vip.co.fo
BETTER_AUTH_SECRET=
BETTER_AUTH_TRUSTED_ORIGINS=

# 默认关闭；本地验收/明确需要时设为 1 或 true
EMAIL_PASS_LOGIN=0

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

# 可选覆盖，默认 `${BETTER_AUTH_URL}/api/auth/callback/sb`
SB_OIDC_REDIRECT_URI=
# 可选覆盖，默认 openid profile offline_access
SB_OIDC_SCOPES=
```

- `BETTER_AUTH_URL` 必须与用户实际访问的站点 origin 完全一致；生产为 `https://vip.co.fo`。
- `BETTER_AUTH_SECRET` 生产使用 ≥32 字节随机值；不得使用本地占位值。
- `EMAIL_PASS_LOGIN` 默认关闭；生产不建议开启，除非明确需要。开启后首次登录自动注册，没有邮箱验证与找回密码。
- provider 变量按需配置：只配置一组时，登录弹窗只显示该 provider；全部缺失且未开启邮箱密码时显示“登录暂未开放”，匿名首页不受影响。
- `.env.example` 写入变量名与非敏感示例；真实值只放 `.env.local` 或部署平台 Secret。

#### 15.9.2 OAuth 应用注册

| Provider | 生产回调                                     | 本地开发回调                                     |
| -------- | -------------------------------------------- | ------------------------------------------------ |
| GitHub   | `https://vip.co.fo/api/auth/callback/github` | `http://localhost:3000/api/auth/callback/github` |
| Google   | `https://vip.co.fo/api/auth/callback/google` | `http://localhost:3000/api/auth/callback/google` |
| SB.SB    | `https://vip.co.fo/api/auth/callback/sb`     | 需单独注册或使用 HTTPS tunnel                    |

- GitHub 需创建 OAuth App；Google 需创建 OAuth Client 并配置同意屏幕；SB.SB 需创建 OIDC 客户端并登记回调。
- Google 生产环境可能涉及 OAuth 同意屏幕验证与域名配置，需预留审核时间。

SB.SB 本地联调是实施前置条件：当前只拿到生产回调 `https://vip.co.fo/api/auth/callback/sb`。如果论坛不允许注册 localhost 回调，需要：

- 为开发环境单独创建一个 SB.SB OIDC 客户端；或
- 使用指向本机的 HTTPS tunnel，并把 tunnel 域名注册为回调。

#### 15.9.3 迁移与发布步骤

1. 备份 Turso 数据库。
2. 生成并审查 Better Auth + mailboxes 迁移。
3. 在 Turso 执行 `bun run db:migrate`。
4. 配置 `BETTER_AUTH_*`、三个 provider 的 client id/secret；生产确认 `EMAIL_PASS_LOGIN` 未开启。
5. 部署并验证：
   - `/api/auth/callback/sb` 可被 SB.SB 回调；
   - Set-Cookie 含 HttpOnly/Secure/SameSite=Lax；
   - 登录后 `/dashboard` 可访问，退出后回到首页；
   - 固定邮箱收发与点号匹配正常；
   - 认证入口限流生效，邮箱密码登录仅在显式开启时出现。
6. 更新 `.env.example`、`README.md`、`DEPLOY.md` 的用户后台章节。
7. 定时清理任务继续只处理匿名邮箱；可顺带清理过期 session。

### 15.10 实施顺序

#### 阶段 1：认证基础

- 锁定 Better Auth 版本，生成并接入 auth schema。
- 实现 `createAuthOptions()`、懒加载 `getAuth()`、provider 可用性判断。
- 配置 GitHub / Google / SB.SB，完成 `mapProfileToUser` 占位邮箱与禁用账号合并。
- 拆分 `auth-server.ts` 与 `auth-functions.ts`，避免客户端 bundle 引入服务端请求 API。
- 改造 `/api/auth/$`、新增 `getViewer` 与认证入口 IP 限流。
- 本地验收可开启 `EMAIL_PASS_LOGIN`；生产默认关闭。
- 首页右上角登录入口 + 登录弹窗。
- `/dashboard` 路由守卫与空页面。

#### 阶段 2：固定邮箱数据与服务

- 迁移 `mailboxes.user_id`、固定邮箱远期 `expires_at` 哨兵、新索引。
- 新增固定前缀规范化与 `canonicalizeFixedAddress`。
- 实现 `owned-mailbox-service`：创建、列表、快照、删除、50 上限 LRU。
- 匿名服务加 `user_id IS NULL` 隔离与冲突状态。
- 补齐服务层单元/集成测试。

#### 阶段 3：后台界面

- `/dashboard` 左栏：创建表单、配额、邮箱列表、复制、删除确认、退出登录。
- 右栏：复用邮件列表/详情，接入轮询、断网、重连、空状态。
- 移动端单列布局、键盘与 aria-live。
- 淘汰/删除/会话过期等 Toast 与空状态。

#### 阶段 4：收件链路

- Webhook 改为匿名严格 + 固定去点双查询。
- 固定邮箱离线收信、删除后忽略、去重与幂等测试。
- 用真实 Mailtrap Webhook + 模拟邮件完成端到端验证。

#### 阶段 5：真实登录与上线

- 注册/核对三个 provider 的回调地址。
- 配置生产环境变量并迁移 Turso。
- 分别用 GitHub、Google、SB.SB 完成一次真实登录；真实凭据未就绪时先用 `EMAIL_PASS_LOGIN` 完成本地验收。
- 浏览器验收首页、后台、50 上限、点号收信、权限隔离。
- 更新部署文档与验收记录。

### 15.11 测试与验收

#### 15.11.1 自动化测试

- 固定前缀：去点、最小 3 位、最大 32 位、大小写、非法字符、全是点、边界点号。
- 固定邮箱：创建、重复打开、列表归属、删除级联、50 上限、LRU 选择、淘汰后计数、并发创建。
- 冲突：固定 vs 匿名占用、固定 vs 其他用户、过期匿名接管、随机前缀重试。
- 匿名回归：匿名快照/peek 不能读取固定邮箱；匿名创建不能返回固定邮箱。
- Webhook：`a.b.c` 命中固定 `abc`；`a.b.c` 不命中匿名 `abc`；固定邮箱离线入库；删除后忽略；多收件人去重；重复 event_id 幂等。
- 认证辅助函数：占位邮箱映射、provider 可用性、配置缺失降级、`EMAIL_PASS_LOGIN` 开关。
- 认证端点限流：`sign-in/email` 10 次/分钟、`sign-up/email` 5 次/分钟、`sign-in/social` 10 次/分钟，按 IP 分桶。
- 安全：固定邮箱按 id 越权返回 not_found；匿名地址读取固定邮箱返回 expired；生产构建不包含 `getRequestHeaders`、`getAuth`、数据库模块。

#### 15.11.2 浏览器验收

- 首页左侧右上角显示登录按钮；弹窗列出已配置的三个 provider。
- GitHub / Google / SB.SB 各完成一次真实登录，成功后进入 `/dashboard`。
- 未登录直接访问 `/dashboard` 会回到首页并自动打开登录弹窗。
- 创建 `abc` 固定邮箱；发送到 `a.b.c@domain` 的邮件出现在后台，且匿名页面用该地址无法读取。
- 创建第 51 个邮箱时自动淘汰最久未打开的邮箱，计数保持 50，Toast 显示被淘汰地址。
- 手动删除邮箱后地址与邮件清除，可重新创建同名地址。
- 固定邮箱地址被活跃匿名邮箱占用时，创建被拒绝且匿名邮箱不受影响。
- 刷新、关闭页面、离线再恢复后固定邮箱与邮件仍在；页面隐藏时停止轮询。
- 退出登录后回到首页；再次登录仍是同一批固定邮箱。
- 未登录直接访问 `/dashboard` 会跳回首页并自动打开登录弹窗。
- 本地开启 `EMAIL_PASS_LOGIN` 后，邮箱密码首次登录自动注册；关闭该开关后登录弹窗不再显示邮箱密码表单。
- 移动端单列布局无横向溢出；对话框、列表操作、复制、删除可用键盘完成。

#### 15.11.3 工程检查

```bash
bun test
bun run lint
bun run check
bun run build
```

- 生产构建产物中不包含 provider secret、Better Auth secret、OAuth token。
- 迁移可在空库和现有 `local.db` 副本上重复应用。
- 真实 OAuth 与 Mailtrap 各记录一次端到端结果。

### 15.12 明确不做

- 默认不提供邮箱密码登录；仅在本地验收/明确需求时通过 `EMAIL_PASS_LOGIN` 开启，仍不提供找回密码与邮箱验证。
- 跨 provider 账号合并、绑定、解绑。
- 用户资料编辑、头像上传、账号注销。
- 2FA、多设备会话管理。
- 匿名邮箱认领/迁移到登录账号。
- 固定邮箱重命名、转让、发件、回复、转发。
- 管理员后台、审计、封禁、滥用处理。
- 附件下载、原始邮件下载、全文搜索、标签、已读状态同步。
- 固定邮箱邮件分页（首期只展示最近 200 封）；后续再加游标分页。
- 多域名、多 Mailtrap Inbox。
- 登录用户隐藏标签页的新邮件标题提示（固定邮箱邮件本身不会丢失）。

### 15.13 风险与待确认

- **Better Auth 版本**：`package.json` 为 `^1.5.3`，当前安装解析到 1.7.14；实施前锁定版本并按实际 API 核对 `genericOAuth`、`mapProfileToUser`、`encryptOAuthTokens` 与 CLI。
- **SB.SB 本地回调**：需要论坛允许 localhost 回调或提供开发客户端；否则 SB.SB 只能在生产/隧道环境验收。
- **固定邮箱 TTL 哨兵**：`expires_at` 保持 NOT NULL，固定邮箱使用 9999-12-31 哨兵；所有匿名查询/清理必须过滤 `user_id IS NULL`，遗漏会把固定邮箱当普通 TTL 邮箱，需用测试锁定。
- **本地 libSQL 事务**：Better Auth 写入与邮箱轮询可能共用单连接；若出现 `TRANSACTION_ACTIVE`，需要扩展 `write-lock` 或为开发环境拆分连接。生产 Turso 多连接需验证。
- **50 上限淘汰是破坏性操作**：必须确保文案、Toast 和测试覆盖；如果产品后续希望保留被淘汰邮箱的邮件，需要改为软删除 + 独立配额策略。
- **200 封显示上限**：固定邮箱永久保留后邮件量可能增长，首期只显示最近 200 封，后续需要游标分页与容量策略。
- **多实例限流与 50 计数**：当前限流是单进程内存；50 计数依赖事务与唯一索引，多实例需补充压测。
- **真实 provider 凭据**：GitHub/Google/SB.SB 的 client id/secret、回调白名单和配额需要在部署前准备。
- **无账号恢复机制**：固定邮箱归属依赖第三方账号；provider 账号丢失或无法登录时，没有邮箱/密码或人工找回路径。本期不做，需在产品文案中明确。
- **Kumo Dialog API**：登录/删除弹窗使用 Dialog；后台用户操作已改为直接按钮，避免 DropdownMenu 的 MenuGroup 上下文限制。
- **EMAIL_PASS_LOGIN**：开启后首次登录自动注册；生产必须保持关闭，除非明确需要。
- **认证限流为进程内内存**：多实例部署时需改为共享存储或网关限流。
