# Coding Site2LLM

这是一个 Chrome 扩展：从当前 coding site 提取题目上下文，组装 prompt，并把 prompt 交给用户已打开的 LLM 页面。

这份文档服务两类读者，内容按这两个入口组织：

- **人**：快速恢复项目上下文，知道下一步改哪里、测什么。
- **LLM**：恢复技术状态，知道哪些是模块契约，哪些只是实现细节。

## A. 给人：快速恢复

### 项目边界

扩展是上下文传输层，不负责替用户分析、总结或改写题目。

### 用户目标优先

所有界面、输入和自动化设计先回答目标用户要完成什么，再选择技术实现。不得把浏览器默认行为、开发者习惯、框架限制或未来扩展计划当作用户目标。用户目标明确后，依次确定任务流程、可接受的输入、错误恢复、产品语言策略，最后才选择原生控件、校验和本地化机制。

当前目标用户是学生和做题者。他们需要在题目、代码编辑器与 LLM 之间快速切换。支持站点、开发者使用的语言和当前网页语言都是实现环境，不能被当作用户画像或界面语言偏好。

当前支持的 coding site：Exercism、LeetCode、Codewars，以及其它 HTTP(S) 页面的原始源码兜底。

当前支持的 LLM：DeepSeek、ChatGPT、Claude、Gemini、DeepAI 等。具体 provider 配置以 `background.js` 为准。

### 日常开发入口

| 要改的行为 | 先看 | 最小验证 |
| --- | --- | --- |
| prompt、站点上下文 | `worker/extract_coding_site_context_with_site_adapters.js` | `npm run test:unit` |
| URL 和站点路由 | `worker/route_coding_page_and_build_llm_prompt.js` | `npm run test:routing` |
| Exercism overview 跳转 | `worker/exercism/open_exercise_in_editor.js` | `npm run test:routing` |
| Exercism 完成确认、concepts 刷新与滚动恢复 | `worker/exercism/auto_mark_exercise_complete.js`, `worker/run_coding_context_to_llm_workflow.js`, `worker/exercism/preserve_concepts_scroll_position.js` | `npm run test:routing` 和 `npm run test:contracts` |
| Exercism 编辑页提交 | `worker/exercism/auto_submit_after_manual_run.js` | `npm run test:contracts` |
| popup 每日练习入口 | `popup/daily_practice_providers.js`, `popup/popup.js` | `npm run test:unit` |
| 扩展注入和 manifest | `manifest.json`, `content.js`, `worker/` | `npm run test:contracts` |
| 开发环境和文件入口 | `tests/dev-check.ps1`, `package.json`, `manifest.json` | `npm run dev:check` |

`dev:check` 的浏览器前置条件来自 Chrome DevTools MCP 的实时 `list_pages`，不是仅凭 Chrome 进程判断。运行 `list_pages` 后，把输出中的页面 URL 和扩展 Service Worker URL 写入新鲜 JSON 快照（格式参考 `tests/chrome-mcp-snapshot.example.json`），至少包含：

```json
{
  "schemaVersion": 1,
  "source": "Chrome DevTools MCP list_pages",
  "mcpConnected": true,
  "connectedAt": "当前 UTC ISO 时间",
  "pages": [{ "url": "页面 URL" }],
  "extensionServiceWorkers": [{ "url": "chrome-extension://扩展 ID/background.js" }]
}
```

快照需在运行前 300 秒内生成；页面列表要包含 Exercism `/edit` 页和 DeepSeek 页面，Service Worker 列表要包含本扩展的 `background.js`。在 PowerShell 设置快照路径后再运行检查：

```powershell
$env:CHROME_DEVTOOLS_MCP_SNAPSHOT = Join-Path $env:TEMP "coding-site2llm-chrome-mcp-snapshot.json"
npm run dev:check
```

不要把带实时页面状态和时间戳的临时快照提交到仓库。

### 标准验证顺序

1. 先运行职责对应的最小测试。
2. 需要确认页面事实时，使用 Chrome DevTools MCP 探测真实 DOM、路由和编辑器状态。
3. 修改未打包扩展后运行 `npm run session:end`；测试通过后，它会依次 reload 扩展并刷新已有 coding/LLM 页面。
4. 配置 `CODING_SITE2LLM_RELOAD_COMMAND` 和 `CODING_SITE2LLM_REFRESH_COMMAND`，分别指向可执行的外部 Chrome/MCP bridge 命令；两项缺失时脚本会在浏览器操作前停止。
5. reload 扩展后必须刷新已有 coding/LLM 页面；旧 content script 的 extension context 已失效。
5. 需要用户点击页面按钮时，明确提醒用户确认；不要用猜测的坐标代替确认。
6. 测试完页面后，默认刷新一下页面，不留残余。

纯文档、测试和修复不递增版本。新增功能默认递增补丁版本 `0.01`，并重新打包到对应的 `.build/v<version>/`。

### 浏览器探测原则

MCP 是调试探针，不是生产依赖。先观察真实运行时，再修改 adapter 或页面脚本。

推荐探测顺序：

```text
真实页面
  -> list_pages
  -> evaluate_script 读取 URL、DOM、编辑器和页面状态
  -> 修改所属模块
  -> 最小测试
  -> reload_extension
  -> 刷新页面复核
```

`list_console_messages` 不足以观察 content script 的异常。需要确认 content script 是否运行时，用页面 `sessionStorage` 写入探针，再从页面主世界读取；不要用会在同源 tab 间串数据的 `localStorage`。

### 当前开发边界

不做通用跨网站编辑器抓取器，不在扩展内生成解题内容，不把 MCP 脚本作为生产运行时依赖。

popup 的每日练习入口由 `popup/daily_practice_providers.js` 的 provider 列表驱动。LeetCode 使用当天 UTC 日期构造 Daily Question 页面；Codewars 直接打开 dashboard。新增站点时只需添加 provider 配置，并扩展对应的 contract test。

### Popup 输入与语言规范

每日练习的自定义地址输入是“保存一个可打开的网站”，不是要求用户手写完整 URL 协议。它必须遵守：

- 先按目标用户的常见操作设计：用户输入或粘贴站点地址后，应能立即加入每日练习列表；技术校验只能保护这个目标，不能替代或阻断它。
- 接受完整 HTTP(S) URL 和裸域名（如 `baidu.com`）；裸域名保存前规范化为 `https://baidu.com/`。
- 只允许 HTTP(S) 目标；拒绝 `javascript:`、`data:` 等非 Web 协议。
- Enter 与点击 Add 使用同一提交路径；取消会清空输入并关闭表单。
- 不使用 `input type="url"` 拦截裸域名。浏览器会在脚本运行前阻止表单提交，并以浏览器 UI 语言显示原生错误气泡，造成输入行为和产品语言不可控。
- 用户可见文案须由面向学生和做题者的产品语言策略决定，不能从开发者语言、支持站点或当前网页语言推断，也不能意外混入浏览器原生校验文案。本地化是后续实现：扩展引入多语言时，使用 Chrome `_locales` 和 `chrome.i18n`，以 Chrome UI 语言选择译文；不要根据页面内容、输入网址或开发者语言猜测用户语言。
- 任何调整必须覆盖裸域名规范化、Enter 提交和非 HTTP(S) URL 拒绝的单元测试。

本次设计失误是先接受浏览器的“格式正确 URL”定义，再倒推用户流程。浏览器的 `type="url"` 只接受绝对 URL，而用户目标是尽快加入一个练习站点；应用层应先支持常见输入，再在保存边界执行明确的协议安全校验。

`.feedback/` 只处理开发者当前推入聊天框的那一条 feedback。验证解决后移动到 `.feedback/old/`，不要顺手处理其它 feedback。

## B. 给 LLM：技术契约

### 核心数据流

```text
coding page
  -> URL route
  -> site adapter
  -> { platform, title, description, source, language, feedback }
  -> prompt builder
  -> selected LLM tab
```

LLM 页不主动分析题目。扩展只负责传输已有页面上下文。

快捷键动作是两个独立的 action：

```text
send-context  : coding page -> LLM page
smart-return  : LLM page -> source coding page
```

默认均为 `Alt+Q`，配置保存在 `codingSite2LlmShortcuts`。动作名是业务契约，按键只是可替换的输入绑定。

快捷键等设计必须符合人体工学：一次按键组合在用户释放前只能触发一次。页面侧用 `event.repeat` 和 held 状态拦截长按重复事件；Service Worker 收到 `keyup` 的释放消息后立即解锁，超时只作为释放消息丢失时的异常兜底，不能被当作正常的快捷键间隔。兜底时间应明显长于普通人的按住时长，避免用户仍在按键时再次触发工作流。

LLM 页的返回路由按 `windowId + llmTabId` 保存。一次发送会把当前 coding 页记录为该 LLM 页的当前返回页；来源页关闭后，返回动作会从该 LLM 页右侧选择第一个同平台的做题页。没有匹配页时不跳转，也不清除已记录的复制文本。

### 模块边界

| 模块 | 只负责 | 不负责 |
| --- | --- | --- |
| `extract_coding_site_context_with_site_adapters.js` | adapter、页面提取、过滤、prompt 数据 | 跨页面导航策略 |
| `route_coding_page_and_build_llm_prompt.js` | URL 路由和 prompt 组装 | 页面自动化和 LLM 交互 |
| `find_llm_tab_and_insert_prompt.js` | 找到指定 provider 并插入 prompt | 站点状态判断 |
| `run_coding_context_to_llm_workflow.js` | 串联发送流程、保存返回路由 | 站点专属 selector |
| `open_exercise_in_editor.js` | 仅判断 overview 是否进入 `/edit` | `Mark as complete`、提交确认 |
| `auto_mark_exercise_complete.js` | 仅发现可用的 `Mark as complete` 并请求完成链 | 是否进入 `/edit` |
| `auto_submit_after_manual_run.js` | 监听用户 Run Tests 并请求提交链 | overview 跳转和完成按钮 |
| `content.js` | 编辑页快捷键桥接 | Exercism 状态推断 |

修改一个模块时，不把另一个模块的 selector、状态缓存或控制条件复制过来。

### Exercism overview 状态机

overview 和 `/edit` 是两个不同的页面状态。`open_exercise_in_editor.js` 只做下面的判断：

| 状态 | overview 跳转模块 |
| --- | --- |
| `available` | 进入 `/edit` |
| `started` | 进入 `/edit` |
| `iterated` | 留在 overview |
| `completed` | 留在 overview |
| 明确显示 `Exercise Solved` | 留在 overview |
| 无法判定 | 留在 overview |

`iterated` 表示已经提交，后续是否出现 `Mark as complete` 属于另一个模块的职责。跳转模块不能读取、缓存或等待这个按钮来决定是否跳转。

状态读取优先级：

1. `[data-react-id="student-open-editor-button"]` 的 `data-react-data.status`。
2. 仅用于识别新题的 `.action-box.pending` fallback；不能用按钮文字判断新旧。
3. 小型 status badge 的 `In progress` 文案只作为 `started` 的页面兜底信号。
4. `Exercise Solved` 是终态信号，优先级高于 `In progress` 文案。

`open_exercise_in_editor.js` 维护自己的 per-tab/per-exercise `sessionStorage` redirect guard，并监听 `turbo:load`、`turbo:render` 和 DOM 变化。这个 guard 只保护跳转模块，不为完成模块提供状态。

### Exercism 完成确认

`auto_mark_exercise_complete.js` 独立监听页面上的可见、可用 `Mark as complete` 按钮，并发送 `exercism-mark-complete` 消息。它不调用跳转函数，也不改变跳转模块的状态。

编辑页提交链由其它模块负责：

```text
Run Tests（按钮可用时）
  -> 等待最近一次 run 通过且文件未变化
  -> 等待 Submit 可用
  -> Submit
  -> overview 出现 Mark as complete
  -> auto_mark_exercise_complete 请求完成链
```

编辑页稳定 selector：

- `.lhs-footer .run-tests-btn button`
- `.lhs-footer .submit-btn button`

不要按按钮文字匹配编辑页的 Run/Submit；tab 栏和结果面板存在同名文本。

### 站点 adapter 输出契约

每个 adapter 返回统一语义：

```text
platform
title
description
source
language
feedback
```

只传输当前题目有用的信息。过滤 editorial、SEO/meta 文本、媒体、性能排名等噪声。

### 测试命令

```powershell
npm run test:unit       # prompt、上下文和反馈清理
npm run test:routing    # URL、provider 和 adapter 路由
npm run test:contracts  # manifest、注入、Exercism wiring 和资源契约
npm run dev:check       # Chrome、MCP、Service Worker、必要页面和文件入口
npm run session:end     # 测试通过后 reload 扩展并刷新已有 coding/LLM 页面
```

禁止在日常开发、功能修改和提交前验证中运行 `npm run test:all`。全量测试耗时过长；必须先从 `tests/` 中按改动职责选择最小覆盖测试，并优先使用对应的 `test:unit`、`test:routing` 或 `test:contracts`。只有用户明确要求全量测试时才可运行 `test:all`。

最小回归必须覆盖：支持站点路由、恶意/不支持 URL、prompt 过滤、Exercism `available/started/iterated/completed` 状态、`Exercise Solved` 终态、编辑页提交链和完成确认链。

### 关键维护规则

- 先确认所属模块，再修改该模块；不要把跨模块行为塞进一个 watcher。
- 页面状态变化通过真实页面验证，不依据猜测的 selector。
- Exercism 的 Turbo 导航不会重新注入 content script，因此持续行为必须监听 Turbo 事件和 DOM 变化。
- Alt 返回路由按 LLM Tab 隔离；来源页关闭后的恢复只接受右侧、同平台的做题页，不使用普通 HTTP 页兜底。
- 快捷键遵循“按住只触发一次、释放立即解锁”；固定超时只做异常恢复，不能用短计时器模拟按键节流。
- 固定 selector、状态定义和快捷键 action 名属于契约；变量名、日志和内部 helper 属于实现细节。
