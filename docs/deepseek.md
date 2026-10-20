# DeepSeek Flash 接入

使用 DeepSeek 官方 API，模型 ID 为 `deepseek-flash`，基础地址为 `https://api.deepseek.com`。接入依据为[官方聊天接口文档](https://api-docs.deepseek.com/api/create-chat-completion)。本项目使用服务端请求和 SSE 流式输出，密钥不会返回浏览器。

## 先跑通关键词问答

打开项目根目录 `.env`，在本地填写密钥。现有 `.env` 已预设非敏感的 DeepSeek 参数，保留演示模式；准备好以下配置后再关闭演示。

```dotenv
DEMO_MODE=false
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=<本地填写，不要发到聊天或提交代码>
CHAT_MODEL=deepseek-flash
CHAT_THINKING=auto
RETRIEVAL_MODE=keyword

SESSION_SECRET=<至少32位随机字符串，已有强随机值可保留>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<至少12位的初始管理员密码>
DATABASE_URL=sqlite:///./data/ddt-production.db
```

上面使用新数据库，避免沿用演示账号。数据库首次创建时会初始化管理员；修改环境变量不会重置已有账号密码。团队部署推荐 PostgreSQL，参见 README。不要在已有 `.env` 上重新覆盖整份示例配置。

重启后端后，在页面使用用户名与密码登录，上传真实产品资料并提问。设置页应显示 `deepseek-flash` 和「关键词检索 · 无需向量服务」。提交问题后，回答逐段出现，并附资料引用。无匹配资料时直接说明依据不足，不调用模型编造答案。

`keyword` 在本地进行 BM25 检索，再把召回的资料片段、问题和会话上下文发送给 DeepSeek；上传时不调用任何向量服务。演示模式下仍是本地摘录，填入密钥也不会自动切换为真实模型。

## 思考模式

`CHAT_THINKING=auto` 会对官方 DeepSeek 发送 `thinking: {"type": "disabled"}`，优先缩短正文等待时间。需要模型思考时可设置 `enabled`；显式关闭可设 `disabled`。两者都支持流式正文，思考内容不会进入聊天记录。对其他兼容接口，`auto` 不发送 DeepSeek 专属参数。

## 后续启用混合检索

官方聊天接口不作为本项目默认向量服务。另选公司批准的、支持 `/embeddings` 的服务，并添加：

```dotenv
RETRIEVAL_MODE=hybrid
EMBEDDING_BASE_URL=https://your-embedding-provider.example/v1
EMBEDDING_API_KEY=<独立向量服务密钥>
EMBEDDING_MODEL=<服务商的向量模型ID>
EMBEDDING_DIMENSIONS=<实际输出维度，1至2000>
```

重启后更新已有文档以建立向量。关键词仍参与召回，向量结果通过 RRF 融合。向量服务会接收文档片段及检索问题。更换聊天模型无需重建向量；修改向量模型、地址或维度需要重建。已有 PostgreSQL 表修改维度还需数据库迁移。

## 排查

- 无法启动：查看服务端配置提示，检查强会话密钥、管理员密码、聊天密钥；未开通向量服务时使用 `keyword`。
- 密码登录失败：环境变量中的初始密码不会覆盖已有账号。需要保留当前资料时，确认 `.env` 中的管理员账号和密码后，在 `backend` 目录执行 `.venv/bin/python -m app.manage reset-admin-password`，再用配置值登录；命令只修改已有且启用的管理员密码。正式部署也可使用新数据库重新初始化。
- 模型服务错误：核对密钥、账户额度、模型 ID、服务端网络以及基础地址，地址不应包含 `/chat/completions` 后缀。不要把完整错误或密钥复制到公开日志。
- 回答不准确：先查看来源是否包含答案、产品版本是否正确。关键词无法匹配同义表达时，可补充资料中的术语或启用混合检索。

目前使用模拟上游响应验证协议；真实账户的连通性和回答质量需要填写本地密钥后验证。
