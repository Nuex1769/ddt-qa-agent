# DDT QA Agent 视觉与组件契约

- 外壳：236px 深墨紫侧栏，白色顶栏；浅暖灰工作区。移动端侧栏改为可访问的抽屉。
- 密度：文档行高 68px；常规控件 36px；问答阅读区域最大宽度 850px。
- 色彩：紫色主操作，绿色就绪状态，琥珀色演示说明；不使用装饰渐变。
- 排版：中文系统字体，正文 14px；标题 26px；数值采用 tabular-nums。
- 形状：6px 控件圆角，10px 面板圆角；细边框主导，弹层使用克制阴影。
- 状态：活动侧栏淡紫底；输入聚焦紫色边框；禁用控件降低不透明度。

## 组件先于页面

`components/ui` 提供基于 shadcn/Radix 的 Button、Input、Textarea、Select、Dialog、AlertDialog、Tooltip、DropdownMenu、Table。统一样式由语义 CSS 令牌决定；删除操作置于更多菜单中，并使用确认弹窗。

`AppShell` 负责导航、身份入口、移动端菜单；`DataTable` 是记录列表与分页的唯一入口；`PageHeader` 和 `ScopeFilters` 服务于文档与问答两个调用方。文档上传、原文预览和用户创建是各页面完整功能模块。只在应用根挂载一个 Toaster，API 和 401 处理集中管理。
