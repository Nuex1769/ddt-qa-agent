# Langfuse 观测记录

管理员可在侧栏的「观测记录」查看本应用产生的问答、文档审查记录，筛选操作类型、执行状态、同步状态，按 Trace ID 或模型搜索，并查看各阶段耗时及模型返回的 Token 用量。普通成员无法访问页面或接口。

本地观测默认开启，无需 Langfuse 账号。记录从此功能启用后开始产生，不回填旧会话，也不读取其他系统写入 Langfuse 的历史记录。每次问答或审查执行结束后落库；进程被强制终止时尚未结束的调用可能没有记录。演示记录明确标记为演示模式，没有模型用量时显示「未返回」，不估算费用。

## 开启外部同步

在 Langfuse 项目设置中创建项目 API 密钥，在项目根目录 `.env` 中配置：

```dotenv
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=<项目 Public Key>
LANGFUSE_SECRET_KEY=<项目 Secret Key>
LANGFUSE_PROJECT_ID=<项目 ID，可选>
```

`BASE_URL` 是实例地址，不包含 `/api/public/otel` 后缀。根据项目区域选择 EU `https://cloud.langfuse.com`、US `https://us.cloud.langfuse.com` 或自部署地址。自部署实例需支持 OTLP/HTTP JSON（Langfuse v3.22.0 及以后）；v4 实例通过 `x-langfuse-ingestion-version: 4` 接收实时记录。项目 ID 可从项目 URL 中获取，用于生成「在 Langfuse 打开」链接。密钥始终保留在服务端，不会通过页面接口返回。

重启后端生效。Docker 部署在修改 `.env` 后执行 `docker compose up -d --force-recreate app`。不需要配置 LlamaIndex 回调：本应用在检索、回答、审查及其模型调用边界记录观测，也包含检索期间的向量调用。

## 记录与同步范围

- 记录操作类型、用户及会话的不透明 ID、执行状态、模式、模型名称、时间、耗时、Token 用量，以及无正文的运行统计。
- 不保存或上报提示词、问题、回答、文档标题/正文、引用片段、模型思考或上游错误正文。用户显示名和登录账号也不作为观测属性发送。
- 失败只记录异常类别和安全的同步错误说明。Token 使用模型返回的 `prompt_tokens` / `completion_tokens`；审查自动补齐建议产生的重试调用也计入总量。部分调用不返回用量时，仅统计已返回部分。
- 同步是独立的后台任务，使用数据库持久队列和 Langfuse 官方 OTLP/HTTP JSON 接口 `/api/public/otel/v1/traces`，使用稳定的 Trace/Span ID。无需新增 SDK 依赖。
- 上报失败不改变问答/审查结果；页面分别显示执行状态和同步状态。后台最多尝试 3 次，失败后退避重试，可在详情中再次加入同步队列。请求超时、HTTP 错误和 OTLP 部分拒收都不会显示「已同步」。
- 关闭同步时继续保存本地记录；历史「仅本地」记录不会自动补传，启用同步后可逐条选择同步。同步中的租约过期后可恢复；达到次数上限后显示失败。
- Langfuse 接收成功表示接口已接收，实际索引显示可能稍有延迟。配置项目 ID 后可打开对应记录。切换实例或项目后，既有记录不自动迁移，应在原实例查看已经同步的历史记录。

本地 `observations` 表通过启动时的增量建表创建，兼容 SQLite 和 PostgreSQL。记录不包含文档快照，因此文档删除后可以保留运行统计。目前没有自动清理策略，管理员需按部署的保留周期维护该表及 Langfuse 项目数据。

## 验证

自动化测试覆盖管理员权限、无正文记录、分页筛选、失败/取消状态、并发上下文隔离、Token 用量，以及模拟 Langfuse 的 OTLP 协议、认证、部分拒收、失败退避、次数上限和手动重试。浏览器测试使用隔离演示环境验证桌面和手机布局、真实生成的记录、分页搜索、详情及请求失败恢复。

未提供 Langfuse 项目密钥时，不连接真实实例，不据此声称真实云端接入已验证。

官方参考：[OpenTelemetry 接入与属性映射](https://langfuse.com/integrations/native/opentelemetry)、[公共 API](https://api.reference.langfuse.com)。
