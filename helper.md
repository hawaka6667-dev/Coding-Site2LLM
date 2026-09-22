# Coding Site2LLM

> 官方技术文档 / POC 技术说明书 / Spec

这份文档的用途不是记录每一次开发过程，而是让两类读者快速恢复状态：

- 人：快速恢复项目上下文，知道下一步应该改哪里、测什么。
- LLM：快速恢复技术状态，知道哪些行为是契约，哪些只是实现细节。

## 1. 项目定位


我是一边刷题一边调试开发，所以默认要打开dev tool mcp，以及提醒我点击浏览器确认

Coding Site2LLM 是一个 Chrome 扩展。它从在线编程网站的当前题目页读取已有上下文，组装成提示词，并将提示词插入用户已经打开的 LLM 页面。

核心原则：

1. 扩展是**上下文传输层**，不负责替用户分析题目，也不重写用户意图。
2. 每个编程网站使用独立 adapter。网站路由、题目内容、编辑器和测试反馈都由对应站点负责提取。
3. 只传输对解决当前题目有用的内容：题目、代码、语言和测试反馈；过滤 editorial、SEO/meta 文本、媒体和性能排名噪声。
4. Exercism 的提交辅助是扩展自己的页面自动化，不是 Exercism 原生功能。

当前支持或已接入的站点包括 Exercism、LeetCode 和 Codewars；LLM 目标包括 DeepSeek、ChatGPT、Claude、Gemini、DeepAI 等，具体配置以 `background.js` 为准。

## 2. 核心数据流

```text
编程网站当前 Tab
   ↓
URL 路由：选择站点 adapter
   ↓
页面运行时提取：题目 / 代码 / 语言 / 测试反馈
   ↓
过滤并组装 prompt
   ↓

| 文件 | 职责 |
| --- | --- |
| `worker/extract_coding_site_context_with_site_adapters.js` | 站点 adapter、页面上下文提取、prompt 清理和 Exercism 页面自动化 |
| `worker/find_llm_tab_and_insert_prompt.js` | 查找目标 LLM Tab 并插入 prompt |
| `worker/inject_scripts_and_control_coding_page.js` | 向编程页面注入脚本并控制页面动作 |
| `worker/route_coding_page_and_build_llm_prompt.js` | URL 路由、上下文路由和 prompt 组装 |
| `worker/run_coding_context_to_llm_workflow.js` | 串联从编程页面到 LLM 页面的一次完整传输 |
| `tests/minimal-core-feature.test.js` | prompt、上下文诊断和反馈清理的最小功能测试 |
| `tests/local-routing.test.js` | URL 和 adapter 路由的局部测试 |
| `tests/global-extension-contract.test.js` | manifest、content script、扩展 wiring 和图标的全局维护测试 |
| `tests/development-environment.test.js` | 文件移动、入口路径和 npm 脚本的快速环境检查 |

## 4. Adapter 设计契约

现代 Web IDE 中，DOM 往往只是显示层，真正的代码在框架或编辑器的运行时模型中。因此不能用一个“读取 textarea.value”的通用方案覆盖所有网站。

已验证的站点策略：
Adapter 的输出应保持统一语义：

```text
platform, title, description, source, language, feedback
```

站点变化时，只应优先修改站点 adapter 和对应的浏览器探针，不应把站点专属 selector 扩散到通用工作流。

## 5. Exercism 特殊行为

Exercism 的编辑页和 overview 页是两个不同的路由状态，不能混为同一页面。

扩展提供的辅助行为：

- 在编辑页拦截 `Ctrl+Enter`，避免编辑器把它解释成普通换行或其他快捷键。
- 按页面实际状态执行 Run Tests、Continue without waiting、Submit 等动作。
- 提交成功后，可按页面确认链执行 mark as complete。

这些行为属于扩展自己的自动化；页面结构变化时，应通过真实页面重新验证，不应假设 Exercism 提供稳定的内部 API。

## 6. MCP 调试探针

MCP 在本项目中的定位是**调试探针**，不是生产抓取器。它用于观察真实 Chrome 中页面运行后的状态：DOM、动态路由、编辑器实例、框架对象和测试结果。

推荐诊断链路：

```text
打开真实题目页
   ↓
Chrome DevTools MCP evaluate_script
   ↓
确认题目、编辑器和反馈的实际来源
   ↓
把已验证的读取逻辑写入对应 adapter
   ↓
运行单元测试并用 Chrome DevTools MCP 复核真实页面
```

网站改版时，先用真实页面确认运行时事实，再修改 adapter。不要从猜 selector 开始反复 reload。

## 7. 测试策略

架构稳定后保持最小但有针对性的回归集：

```text
npm run test:unit       # 开发功能时的最小核心测试
npm run test:routing    # 修改 URL 或 adapter 路由时运行
npm run test:contracts  # 全局维护时的 manifest、wiring 和资源契约
npm run test:setup      # 移文件或改入口配置后的快速环境检查
npm run test:all        # 主动进行全局维护时运行全部测试
npm run smoke     # [deprecated] 旧 HTTP remote-debugging 页面探测
```

默认策略是非必要不测试：只改文档、注释或不影响入口的文件名时不运行测试；开发功能时只运行 `test:unit`，局部路由改动只运行 `test:routing`，移动文件或修改入口配置只运行 `test:setup`；`test:contracts` 和 `test:all` 只用于全局维护，不作为日常开发测试。

最小回归范围必须覆盖：

- 支持站点、overview 页和编辑页的 URL 路由。
- 不支持 URL、恶意域名和 `view-source:` 页的拒绝。
- prompt 中题目、代码、语言和有效反馈的保留。
- LeetCode editorial、性能排名等无关文本的过滤。
- Exercism 的 content script、提交辅助和 mark-complete 确认链。

站点 selector、编辑器实现或 SPA 路由变化时，用 Chrome DevTools MCP 重新探测真实页面。旧 smoke test 仅保留兼容性；完整扩展 workflow 由单元和契约测试覆盖。

## 8. 开发与刷新流程

1. 修改对应的 adapter 或 workflow 文件。
2. 先运行职责对应的最小测试：核心功能用 `test:unit`，路由用 `test:routing`，扩展能力用 `test:contracts`，移动文件或配置用 `test:setup`。
3. 使用 Chrome DevTools MCP 在真实页面运行探针，确认页面 DOM、编辑器和测试反馈。
4. 使用 Chrome DevTools MCP 的官方 `reload_extension` 刷新未打包扩展。
5. 在编程页面和目标 LLM 页面各验证一次端到端传输。

`tests/deprecated/browser-smoke.test.js` 和 `npm run smoke` 保留用于兼容旧的
HTTP remote-debugging 流程，现已 deprecated；不要把它作为默认页面验证入口。

当前未打包扩展 ID：`loccbnegdbnncgomcaemokbffafjijpj`。

`reload_extension` 通过 CDP 的 Target 能力刷新扩展，不依赖自制的 HTTP `/json` 调试循环。项目不保留旧的 `dev-loop.js` 方案。

## 9. 当前边界与后续方向

当前明确不做：

- 通用的跨网站编辑器抓取器。
- 在扩展内生成、总结或改写解题请求。
- 把 MCP 调试脚本当作生产运行时依赖。

可选的后续工作：

- 增加统一的 adapter 诊断输出，展示 title、description、editor、code、language、feedback 各字段的状态。
- 为各站点增加独立的 browser integration test。
- 当站点支持范围扩大后，为 adapter 输出建立显式 schema 校验。

