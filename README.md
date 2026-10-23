# DDT QA Agent

公司内部产品知识库问答工作台。支持文档入库、产品/版本筛选、多轮追问、SSE 流式回答、来源原文和部门权限。

前端为 React + TypeScript + Vite，后端为 FastAPI，LlamaIndex 负责文字分块。提供可立即运行的本地演示模式，以及兼容模型 API 和 PostgreSQL/pgvector 的接入实现。

已新增酒馆业务第一版：管理员维护酒单与内部配方，原生微信小程序提供需求推荐、购物车、口味偏好和基于已完成订单推测的“老样子”，暂不提交订单或支付。进入后台侧栏「酒单与配方」开始；小程序配置、导入模板与接口见 [酒馆使用指南](docs/tavern.md)。

## 本地体验

需要 Node.js 22.12+（建议 24 LTS）和 [uv](https://docs.astral.sh/uv/)。Python 支持 3.11–3.14，依赖已锁定。

```bash
cd /Users/nocker/Documents/www/ddt-qa-agent
bash scripts/dev.sh
```

浏览器访问 [http://localhost:5173](http://localhost:5173)，点击「以演示管理员身份进入」。也可以选择产品部或客服部成员，对比文档可见范围。首次启动会导入 5 份**虚构的演示产品资料**，并在页面明确标注。

演示模式无需 API 密钥：使用 SQLite 持久化和中文双字词/英文词 BM25 检索，流式回答是资料摘录，不是大模型推理。**演示模式不发送文档或问题给外部模型。** 示例文档删除后不会随重启自动恢复。

也可分开启动，便于调试：

```bash
# 终端一：后端
cd backend
uv sync --frozen
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 终端二：前端
cd frontend
npm ci
npm run dev
```

开发界面是 5173 端口，后端是 8000 端口；前端通过 Vite 转发 `/api`，认证使用同源 HttpOnly Cookie。两个端口需空闲。

## 已实现的工作流

- **文档管理**：PDF、DOCX、Markdown、TXT；默认 20 MB；文字提取、LlamaIndex 分块、索引、原文预览、更新、删除、重复文件检查、搜索和分页。暂存并解析成功后才替换旧索引，失败不会破坏旧文档。
- **知识问答**：产品与版本范围、最近 10 条同范围有效消息的上下文、短追问结合上一问题检索；无依据时明确拒答。支持 BM25 关键词检索；可选向量召回并通过 RRF 融合排序。
- **流式交互**：检索进度、资料来源、增量正文、完成/失败事件；可停止生成；断流不会显示成功；已生成的部分内容和状态会保存。
- **来源验证**：展示文档、产品、版本和片段序号。来源变化后，不继续展示旧的敏感内容或过期依据，提示重新提问。
- **权限隔离**：管理员/成员、全公司/本部门/管理员可见；列表、检索、原文和历史引用在服务端校验。每人只拥有自己的会话。
- **成员管理**：管理员创建普通成员账号，指定部门；PBKDF2 密码散列、登录频率限制、12 小时签名会话、来源校验和登出。
- **文档审查与发布**：在「知识文档」点击「审查」，逐段检查冲突、缺失和表述，并检索当前账号可访问的相关资料；没有相关资料时只分析当前文档。支持追问、停止、继续未完成审查、逐条采用建议、编辑草稿、并排版本对比和确认发布。管理员可在「更多操作 → 版本与草稿」重新打开保存的草稿及已发布历史。
- **观测记录 / Langfuse**：管理员查看问答与审查的执行阶段、耗时、Token 用量及同步状态，支持搜索筛选、分页与详情。默认本地记录，可选后台同步到 Langfuse；不记录问题、回答和文档正文。配置步骤见 [Langfuse 接入指南](docs/langfuse.md)。

审查对话按用户和文档当前修订隔离，可查看资料的成员可以审查；只有管理员可以采用建议、保存草稿、查看版本历史和发布。采用建议会先保存为草稿，尚未发布的内容不参与检索。发布时重建索引并保留旧版本；文档或草稿被其他窗口更新时，会阻止覆盖。引用的其他资料发生变化后，需重新审查。

每条审查问题必须附有具体的「处理建议」。有明确依据时给出可采用的修改文本；事实不足或资料权威性不明时，仍需说明具体核实步骤和确认后的更新方法。模型遗漏处理建议时自动要求补齐一次，仍不合格则标记本轮未完成，不展示为审查成功。旧审查记录缺少处理建议时，可重新发起审查生成。

审查后的修订稿以 Markdown 正文保存，包括从 PDF/DOCX 提取的文字；不会修改原始二进制文件或保留其原版式。演示审查仅提供结构建议以验证操作流程，不能代表真实的冲突检测质量；正式审查使用已配置的聊天模型。超过单轮时限时保留已审查分段，可继续剩余部分。

## 接入真实模型

首次配置时将根目录 `.env.example` 复制为 `.env`；已有 `.env` 时直接编辑，保留原有密钥。已预设 DeepSeek 官方 Flash，详细步骤见 [DeepSeek 接入指南](docs/deepseek.md)。不要把密钥放入浏览器代码或提交到版本库。

```dotenv
DEMO_MODE=false
SESSION_SECRET=<至少32位的随机字符串>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<至少12位的管理员密码>

MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=<本地填写的DeepSeek密钥>
CHAT_MODEL=deepseek-flash
CHAT_THINKING=auto
RETRIEVAL_MODE=keyword
```

聊天模型使用 `/chat/completions` 流式兼容接口。`keyword` 只在本地检索资料，再由 DeepSeek 生成答案，无需向量服务。`CHAT_THINKING=auto` 对官方 DeepSeek 发送 `thinking.type=disabled`，减少思考等待；其他兼容服务不发送该专属参数。可设 `enabled` 或 `disabled` 显式控制支持该参数的模型，思考内容不会作为回答显示或保存。

启用语义检索时，设置 `RETRIEVAL_MODE=hybrid`，另外配置 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`。向量服务需提供 `/embeddings`，返回维度应与配置一致；不默认把 DeepSeek 聊天接口用于向量生成。不自动下载模型。兼容旧配置：同一个服务提供聊天和向量时，向量地址/密钥可以省略；独立地址必须使用独立密钥，不会把聊天密钥转发给另一服务。

**关闭演示后，问题、历史上下文及召回的片段会发送给聊天服务；文档审查会分段发送目标文档正文、内部相关上下文及相关资料片段。仅 hybrid 模式会额外把上传的文档片段和检索问题发送给向量服务。** 请配置公司允许使用的服务，也可使用提供兼容接口的内网模型。

配置修改后重启后端。关键词模式可直接检索已有资料。启用混合检索或切换 Embedding 模型、地址或维度后，需要重新上传/更新文档建立相应向量，文档页会提示配置不一致的资料。更换聊天模型不要求重建向量。

管理员仅在数据库首次没有同名账号时创建；修改 `.env` 中的初始密码**不会重置已存在账号**。从演示切换到正式环境，建议使用新的 PostgreSQL 数据库，并初始化正式管理员，避免沿用演示数据与账号。

如果已有管理员提示「账号或密码不正确」，需要保留当前数据库时，先在 `.env` 中确认 `ADMIN_USERNAME`，并将 `ADMIN_PASSWORD` 设为所需的 12–256 位密码，然后在项目根目录执行：

```bash
cd backend
.venv/bin/python -m app.manage reset-admin-password
```

该命令仅更新配置中已有且启用的管理员密码，保留文档、对话及其他账号，不输出密码。执行成功后使用 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD` 的值登录，无需重建数据库。容器部署可执行 `docker compose exec app .venv/bin/python -m app.manage reset-admin-password`；修改 `.env` 后需先重新创建应用容器，使其加载新配置。

## PostgreSQL 与容器部署

根目录提供单应用容器（静态前端 + API）及 PostgreSQL/pgvector 的 Compose 配置：

```bash
cp .env.example .env
# 编辑 .env：关闭演示、填写模型、设置强 SESSION_SECRET / ADMIN_PASSWORD / POSTGRES_PASSWORD。
docker compose up --build -d
```

本机访问 [http://localhost:8000](http://localhost:8000)。数据库只在容器内网暴露，应用默认仅绑定本机地址；需团队访问时，使用已有 HTTPS 反向代理。数据库和应用数据使用独立持久卷。

- 将实际域名加入 `ALLOWED_ORIGINS`，不要使用任意来源。
- HTTPS 环境设置 `COOKIE_SECURE=true`，并替换演示会话密钥和数据库密码。
- `POSTGRES_PASSWORD` 建议使用随机十六进制字符，避免 URL 内特殊符号需要编码的问题。
- `EMBEDDING_DIMENSIONS` 决定初始向量字段维度；已有 PostgreSQL 表切换维度时，需要迁移字段并重建索引，不能只改环境变量。
- SSE 反向代理必须关闭缓冲，示例见 [docs/nginx.conf.example](docs/nginx.conf.example)。

当前数据库表通过 `create_all` 初始化，适用于新项目；后续改变已有表结构时应添加显式迁移。生产备份以 PostgreSQL 数据为主，原始二进制文件不保留，库中保存提取后的文字和元数据。

## 验证

```bash
bash scripts/check.sh

# 启动前后端后进行真实浏览器验收
cd frontend
npx playwright install chromium  # 如果本机没有可用 Chromium / macOS Chrome
npm run test:e2e
```

后端测试使用独立临时数据库，不会操作本地资料。浏览器测试应在开发/演示空间运行：会创建测试会话和一个测试成员，并上传、删除测试文档。桌面和移动端截图输出到 `artifacts/`。

更详细的实现与限制见 [docs/architecture.md](docs/architecture.md)；视觉与组件规范见 [docs/design.md](docs/design.md)。

## 目录

```text
backend/app/       配置、认证、数据库、文档解析、检索和流式接口
backend/tests/     权限、会话、资料变更、错误和模型协议测试
frontend/src/     问答工作台、知识文档和设置
frontend/e2e/     真实浏览器工作流
examples/         明确标注为虚构的示例资料
scripts/          本地启动与检查
docs/             架构、视觉规范、反向代理示例
compose.yaml      应用与 PostgreSQL/pgvector
```
