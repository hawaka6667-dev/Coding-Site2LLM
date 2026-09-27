# Coding Site2LLM

这是一个 Chrome extension：从当前 coding site 提取 problem context，组装 prompt，并把 prompt 交给用户已打开的 LLM page。
以及各种快捷功能

这份文档面向两类读者，内容按这两个入口组织：

- **人**：快速恢复 project context，知道下一步改哪里、测什么。
- **LLM**：恢复 technical context，知道哪些是 module contract，哪些只是 implementation detail。

## A. 给人：快速恢复

### 项目边界

extension 是 context-transport layer，不负责替用户分析、总结或改写题目。

### 用户目标优先

所有 UI、input 和 automation design 先回答 target user 要完成什么，再选择 implementation。不得把 browser default behavior、developer habits、framework constraints 或 future feature plans 当作 user goals。目标明确后，依次确定 user workflow、可接受的 input、error recovery、product language policy，最后才选择 native controls、validation 和 localization mechanism。

当前 target users 是学生和做题者。他们需要在题目、code editor 与 LLM 之间快速切换。supported coding sites、developer 使用的语言和当前 page language 都是 runtime environment，不能被当作 user persona 或 UI language preference。

当前支持的 coding sites：Exercism、LeetCode、Codewars，以及其它 HTTP(S) pages 的 raw-source fallback。

当前支持的 LLM providers：DeepSeek、ChatGPT、Claude、Gemini、DeepAI 等。具体 provider configuration 以 `background.js` 为准。

### 日常开发入口

| 要改的 behavior | 先看 | 最小 validation |
| --- | --- | --- |
| 要改的 behavior | 先看 | 最小 validation |
| --- | --- | --- |
| prompt、site context | `worker/extract_coding_site_context_with_site_adapters.js` | `npm run test:unit` |
| URL routing 和 site routing | `worker/route_coding_page_and_build_llm_prompt.js` | `npm run test:routing` |
| Exercism overview redirect and completion confirmation | `worker/exercism/overview/open_exercise_in_editor.js`, `worker/exercism/overview/auto_mark_exercise_complete.js` | `npm run test:routing` 和 `npm run test:contracts` |
| Exercism track-list scroll restoration | `worker/exercism/concepts_and_exercises/preserve_track_list_scroll_position.js` | `npm run test:routing` 和 `npm run test:contracts` |
| Exercism editor bridge and submission | `worker/exercism/edit/content.js`, `worker/extract_coding_site_context_with_site_adapters.js`, `worker/run_coding_context_to_llm_workflow.js`, `worker/exercism/edit/auto_submit_after_manual_run.js` | `npm run test:routing` |
| Codewars Smart Return write-back and full-suite attempt | `worker/extract_coding_site_context_with_site_adapters.js`, `worker/run_coding_context_to_llm_workflow.js` | `npm run test:unit` |
| Exercism Continue dialogs | `worker/exercism/edit/continue_after_exercism_modals.js`, `tests/fast-core-feature.test.js` | `npm run test:unit` |
| popup daily-practice entry | `popup/daily_practice_providers.js`, `popup/popup.js` | `npm run test:unit` |
| extension injection 和 manifest | `manifest.json`, `worker/` | `npm run test:contracts` |
| development environment 和 entry points | `tests/dev-check.ps1`, `package.json`, `manifest.json` | `npm run dev:check` |

`dev:check` 检查 repository entry points、manifest 和 Chrome process。浏览器实时状态直接通过 Chrome DevTools MCP 的 `list_pages` 查看；不需要导出、保存或维护快照文件。

### 标准验证顺序

1. 先运行与改动职责对应的 smallest relevant test。
2. 需要确认 page behavior 时，使用 Chrome DevTools MCP 检查真实 DOM、routing 和 editor state。
3. 修改 unpacked extension 后，测试通过先 reload extension，再刷新本次改动影响到的已打开 coding/LLM 页面。
4. 用户要求 `reload` 时，重载扩展并刷新受影响网页；不判断、保护或处理任何页面内容。
5. 扩展 reload 使用 Chrome DevTools MCP 的 `reload_extension`；随后通过扩展 Service Worker 单次调用 `chrome.tabs.query` 和并行 `chrome.tabs.reload` 刷新目标网页。不得把这项工作扩展成内容保护任务。
7. 需要用户点击 UI control 时，明确提醒用户确认；不要用猜测的 coordinates 代替确认。
8. 页面验证结束后，默认刷新受影响页面；不处理页面内容。

### 测试挂起与超时防护

- 新增或修改 asynchronous tests 时，检查每个 pending Promise 在 test path 上都能 resolve 或 reject；VM/iframe 等 isolated context 使用的 callbacks 和 resolvers 必须显式注入，避免 error 被异步捕获后 test 仍无限等待。
- 怀疑 Node test hang 时先单独运行，并启用 test-level timeout，例如 `node --test --test-timeout=10000 tests/fast-core-feature.test.js`；不要为了排查直接运行 `test:all`。
- timeout 用来发现 test 未完成，不等同于证明存在 infinite loop。Synchronous infinite loop 会 block event loop，应使用 external process-level timeout 并检查 CPU usage；pending async Promise 通常表现为 test timeout 或进程仍有 active handles。
- 断言 VM 等 cross-realm values 时，比较明确 fields，或先转换为 host-realm plain objects，避免 prototype mismatch 造成误报。

Documentation-only changes, tests, and bug fixes do not increment the version. By default, new features increment the patch version by `0.01`; Git tags and GitHub Releases retain the release history.

### 浏览器探测原则

MCP 是 debugging probe，不是 production dependency。先观察 live runtime，再修改 adapter 或 page script。

检查页面切换时，先区分整页 hard navigation 与 SPA/Turbo client-side navigation。后者可在不重建 document、不重新注入 content script 的情况下改变 URL、题目内容和 editor DOM；不能仅凭 tab id 不变或 URL 改变，就假设脚本、页面状态或编辑器已刷新。

跨页面维护路由按题目身份而非完整 URL 判断：同 URL 刷新以及同题的 SPA/Turbo 路由变化都保留维护；身份变化才删除整条路由和旧复制 payload。LeetCode 同一 problem slug 的根页、query/hash 和 `/submissions/...` 属于同题；submission 页面上下文使用 LeetCode adapter 提取，但不是可编辑目标，Smart Return 必须选择同题根页 editor；Exercism overview 与 `/edit` 使用同一 track/exercise 身份；Codewars 使用 kata 与训练语言身份。其它 HTTP(S) 来源按完整 URL 区分。Chromium 的 History API 客户端导航使用 `webNavigation.onHistoryStateUpdated` 探测，并限制在主 frame；该 API 需要 manifest 的 `webNavigation` permission。

推荐探测顺序：

```text
live page
  -> list_pages
  -> evaluate_script 检查 URL、DOM、editor 和 page state
  -> 修改 owning module
  -> smallest relevant test
  -> reload_extension
  -> refresh page 并复核
```

执行扩展刷新时，先调用 Chrome DevTools MCP 的 `reload_extension`，再通过扩展 Service Worker 单次批量刷新本次改动影响到的网页；不处理网页内容。

`list_console_messages` 无法完整观察 content script errors。需要确认 content script 是否运行时，从 page context 写入 `sessionStorage` probe，再从 page main world 读取；不要使用会在 same-origin tabs 间共享数据的 `localStorage`。

### 当前开发边界

不做 generic cross-site editor scraper，不在 extension 内生成 solution content，不把 MCP scripts 作为 production runtime dependencies。

popup 的 daily-practice entry 由 `popup/daily_practice_providers.js` 的 provider list 驱动。LeetCode 使用当天 UTC date 构造 Daily Question page；Codewars 直接打开 dashboard。新增 coding site 时只需添加 provider configuration，并扩展对应的 contract test。

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

### 页面导航与 editor lifecycle

同一标签页的页面切换不一定是整页加载：

| 导航类型 | 页面行为 | 扩展侧约束 |
| --- | --- | --- |
| hard navigation | document 被替换；匹配的 content script 按 manifest 重新注入 | 依赖新 document 初始化的逻辑放在正常注入入口 |
| SPA/Turbo navigation | History API 或站点 router/Turbo 更新 URL、内容或局部 DOM；document 和已注入脚本继续存在 | 不等待重新注入；长生命周期逻辑监听站点路由事件及所需 DOM/state 变化 |

切题、返回题目或其它同页路由切换后，必须在动作发生时重新读取当前 URL、可见 editor 和它绑定的 model；不能复用页面初次加载时缓存的 editor/model。若 editor 正在卸载或重建，adapter 可有界等待当前可见实例就绪；editor 列表暂时为空时，不得把残留的全局旧 model 当成当前 editor 写入。

Exercism 的 `Back to Exercise` 是具体的 Turbo 导航例子：`return_to_editor_after_submit_redirect.js` 通过 `turbo:before-visit` / `turbo:load` 处理提交后的同页跳转；`open_exercise_in_editor.js` 也监听 Turbo 生命周期及 DOM 变化。LeetCode 切题后的 Monaco 延迟挂载由 `tests/local-routing.test.js` 覆盖。新增或修改导航行为时，测试必须区分整页加载与客户端路由，并验证切换后使用的是当前页面/editor 状态。

快捷键动作是两个独立的 action：

```text
send-context  : coding page -> LLM page
smart-return  : LLM page -> source coding page
```

在 coding page 按下 `send-context` 时，若页面有非空鼠标选区，只发送选区原文并跳过整页 context 提取；没有选区时保持原有整页题目 context 发送流程。`smart-return` 不读取选区。

默认均为 `Alt+Q`，配置保存在 `codingSite2LlmShortcuts`。动作名是业务契约，按键只是可替换的输入绑定。

每个 action 最多有两个独立输入绑定；Options 默认显示一个，点击 Add 后才显示第二个。存储值为至多两个字符串组成的数组；读取旧版单字符串时迁移为单元素数组。键盘组合和鼠标侧键 `Mouse4` / `Mouse5` 都是有效绑定。

快捷键等设计必须符合人体工学：一次按键组合在用户释放前只能触发一次。页面侧用 `event.repeat` 和 held 状态拦截长按重复事件；Service Worker 收到 `keyup` 的释放消息后立即解锁，超时只作为释放消息丢失时的异常兜底，不能被当作正常的快捷键间隔。兜底时间应明显长于普通人的按住时长，避免用户仍在按键时再次触发工作流。

LLM 页的返回路由按 `windowId + llmTabId` 保存。一次发送会把当前 coding 页记录为该 LLM 页的当前返回页；来源页关闭后，返回动作会从该 LLM 页右侧选择第一个同平台的做题页。没有匹配页时不跳转，也不清除已记录的复制文本。

返回路由是用户通过 `send-context`（默认 Alt+Q；popup 使用同一 workflow）明确建立的维护授权，按 `windowId + llmTabId` 关联到发送时的 source tab、URL 和题目身份。硬导航、History API 和 hash 导航都按站点身份比较；同题 URL 变化保留维护，身份变化删除整条路由和旧复制 payload。Smart Return 执行前再次比较当前 source 身份，阻止导航事件竞态把旧 payload 写入新题。

| 站点 | 维护身份 | 编辑目标约束 |
| --- | --- | --- |
| LeetCode | `/problems/:slug` 的 slug；忽略 query、hash 与同题子路由 | 只匹配 `/problems/:slug` 根页；`/submissions/...` 可证明同题但不能作为 Monaco 回填目标 |
| Exercism | track + exercise slug；overview 与 `/edit` 相同 | overview 与编辑页仍是不同页面能力，不能把 overview 当作代码编辑器 |
| Codewars | kata slug + train language | 只能使用同一身份的训练页 |
| 其它 HTTP(S) 来源 | 完整 URL | 不跨 URL 猜测题目身份 |

同题 source tab 当前不是编辑目标时，Smart Return 只可选择身份相同的可编辑 tab；身份已知但没有匹配目标时不得退回到任意同平台页面。只有下一次显式 `send-context` 才能为新题建立维护。

### 可复用工作流生命周期

发送、复制、回跳不是一次性的线性脚本，而是同一 LLM tab 上可反复执行的独立 cycle。任何跨页面 workflow 都必须显式定义 `idle -> captured -> consuming -> idle` 的状态转换，以及 success、failure、cancel 和无目标页各自的终态；不能只实现首次成功路径后留下 in-flight flag、缓存文本或页面状态给下一次调用复用。

Smart Return 的复制文本是一次性 payload：新复制必须替换旧 payload；找到目标页后，无论代码写入、测试或提交成功或失败，payload 都必须在 `finally` 中消费并清空，下一次回跳只可使用新的复制事件。仅在没有匹配目标页时保留 payload，避免用户关闭来源页后丢失尚未消费的复制内容。扩展 reload、Service Worker 重启和页面 Turbo 导航都必须按这个 lifecycle 恢复可用状态，不能让上一轮的 payload 意外进入下一轮。

测试必须至少覆盖同一 tab 的两轮连续 workflow，以及第一轮在写入、运行或提交阶段失败后第二轮仍能正常开始；不要只用单次成功断言证明 workflow 正确。

### 模块边界

| 模块 | 只负责 | 不负责 |
| --- | --- | --- |
| `extract_coding_site_context_with_site_adapters.js` | adapter、页面提取、过滤、prompt 数据、站点专属编辑器回写和测试提交 | 跨页面导航策略 |
| `route_coding_page_and_build_llm_prompt.js` | URL 路由和 prompt 组装 | 页面自动化和 LLM 交互 |
| `find_llm_tab_and_insert_prompt.js` | 找到指定 provider 并插入 prompt | 站点状态判断 |
| `run_coding_context_to_llm_workflow.js` | 串联发送流程、保存返回路由；已确认的 Exercism 提交可在自动完成开启时后台打开同题 overview | 站点专属 selector |
| `open_exercise_in_editor.js` | 仅判断 overview 是否进入 `/edit` | `Mark as complete`、提交确认 |
| `auto_mark_exercise_complete.js` | 仅发现可用的 `Mark as complete` 并请求完成链 | 是否进入 `/edit` |
| `auto_submit_after_manual_run.js` | 监听用户 Run Tests 并请求提交链 | overview 跳转和完成按钮 |
| `return_to_editor_after_submit_redirect.js` | 拦截 Submit 导致的同题 overview Turbo 跳转并留在 `/edit` | overview 的普通进入编辑器策略 |
| `continue_after_exercism_modals.js` | 关闭 edit 页上可见、可用的 `Continue` 弹窗 | Submit 和 overview completion |
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
编辑页初始化
  -> 读取 Run Tests / Submit / 当前运行结果状态
  -> 监听页面状态变化并更新本地状态
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

`continue_after_exercism_modals.js` 只检查可见 dialog 中的按钮，支持 `Continue` 与 `Continue without waiting`；除 dialog 子节点变化外，还监听 `disabled` 和 `aria-disabled` 属性变化，以便按钮一变为可用就继续。`tests/fast-core-feature.test.js` 覆盖延迟启用到关闭 dialog 的状态转换。

自动完成链必须区分 iteration passed 与 exercise completed。`Exercise Solved` 只表示提交的 iteration 通过，不能单独作为完成成功信号；完成链只在 overview 状态为 `completed` 或出现可见的完成结果对话框后返回成功。`tests/local-routing.test.js` 覆盖条件按钮出现 → 发起完成请求 → 确认弹窗 → 完成结果输出，并断言结果出现前不刷新 track concepts。

**【待真实流程验证】** 最新 Run Tests 通过并完成 Submit 后，Exercism 会发起同题 overview 的 Turbo 导航。`return_to_editor_after_submit_redirect.js` 从 `Back to Exercise` 链接读取实际 `href`，通知 Service Worker 在未聚焦的新窗口打开同题 overview，同时把原标签留在 `/edit`，避免新增标签挤占当前窗口。Service Worker 只接受同源、同题 URL；`exercismAutoMarkComplete` 关闭时不创建 overview 窗口。overview 的 `auto_mark_exercise_complete.js` 负责发现 `Mark as complete` 并运行完成确认链；确认成功及概念页刷新完成后，Service Worker 自动关闭 overview 标签及其窗口。代码和路由测试已覆盖未聚焦新窗口；真实浏览器中的提交流程与关闭行为仍待验证。

不要按按钮文字匹配编辑页的 Run/Submit；tab 栏和结果面板存在同名文本。

编辑页自动化必须先建立当前页面状态，不能在收到快捷键、回跳或点击事件后才以一次 DOM 读取推断状态。编辑器替换代码后，React 状态和 footer 控件可能尚未同步；此时旧的双禁用状态不表示“没有变更”。初始化负责读取当前 Run Tests、Submit、运行中和运行结果，并在 DOM/React 状态变化时更新；工作流只消费这个状态模型，不能复制 selector 或各自重建临时状态判断。缺少初始化属于设计问题，不应以固定延迟、重试或在 adapter 内散落的临时轮询替代。

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

Codewars Smart Return 必须通过 `#code .js-editor .CodeMirror` 的 CodeMirror 实例 `setValue()` 更新 solution model；不要写内部 textarea 或 `#fixture` 样例测试编辑器。完整测试提交使用 `#attempt_btn`，不要依赖合成 `Ctrl+Enter` 事件。

### Exercism 页面测试原则

所有 Exercism 页面相关测试都应提供 `state-transition coverage`：从明确的 `initial state` 开始，经过页面的真实 `production flow` 和中间状态转移，最终断言 `terminal state` 及必要的 `side effects`。按 `initial state -> actions/intermediate states -> terminal state` 组织测试，不以单独断言 selector 命中、message payload、function return value 或 source structure 代替完整流程验证。

- 覆盖用户可观察的关键状态转换，例如 `available -> /edit -> started`、`iterated -> Mark as complete -> Confirm -> completed`、编辑页 `Continue dialog -> no dialog`，以及 `Run Tests -> Submit -> iterated`。
- 可以 stub 外部的 DOM、timing 和 Chrome API boundaries，但必须运行实际的 page script、service-worker message listener 和 adapter，也就是该用例的 `system under test (SUT)`；不能 mock 掉正在验证的状态转换环节。
- 断言 `terminal state`，并检查与该流程直接相关的 `side effects`；只保留保护不同状态转换、failure boundaries 或 stable contracts 的测试。多个测试重复覆盖同一流程时，应合并为清晰的 state scenario，避免堆叠 implementation-detail tests。
- 实际 DOM 和 routing behavior 需要通过浏览器 MCP 探测；模拟测试用于验证 production flow，不能称作真实浏览器 `end-to-end (E2E) test`。

### 测试命令

```powershell
npm run test:unit       # prompt、上下文和反馈清理
npm run test:routing    # URL、provider 和 adapter 路由
npm run test:contracts  # manifest、注入、Exercism wiring 和资源契约
npm run dev:check       # Chrome、MCP、Service Worker、必要页面和文件入口
npm run session:end     # 测试通过后 reload 扩展并刷新已有 coding/LLM 页面
npm run release         # 已提交版本的一键测试、打包、推送、打 tag 和 GitHub Release 发布
```

`npm run release` 仅从 `main` 发布已提交的 manifest version。它一次运行所有 release tests、生成 CRX/ZIP、推送 `main`、创建或复用同名 tag，并创建或更新 GitHub Release。`.codegraph/` 状态和 `.feedback/Snipaste_*` 本地截图不阻塞发布；其它未提交的文件会阻止发布，避免把不完整的功能误发出去。

GitHub Release 仅上传 CRX。ZIP 仍会生成并保留在本地 `.build/`，作为网页安装不支持 CRX 时的后备产物；在确认不再需要前，不删除 ZIP 打包逻辑。

### 构建与发布目录

```text
.build/package.ps1  # 受版本控制的打包脚本
.build/release.ps1  # 受版本控制的发布脚本
.build/coding-site2llm.pem         # 本机唯一 CRX signing key，已忽略，不提交
.build/Coding-Site2LLM-v*.crx/.zip # 当前一次打包的产物，已忽略，每次打包覆盖
```

不要按版本保留本地产物或复制 signing key。版本历史和可下载产物由 Git tag 与 GitHub Release 保存；本地只保留一个稳定的 `.build/coding-site2llm.pem`，保证后续 CRX 的扩展 ID 不变。

禁止在日常开发、功能修改和提交前验证中运行 `npm run test:all`。全量测试耗时过长；必须先从 `tests/` 中按改动职责选择最小覆盖测试，并优先使用对应的 `test:unit`、`test:routing` 或 `test:contracts`。只有用户明确要求全量测试时才可运行 `test:all`。

最小回归必须覆盖：支持站点路由、恶意/不支持 URL、prompt 过滤，以及 Exercism 各关键页面流程的状态闭环（`available/started/iterated/completed`、`Exercise Solved`、编辑页提交链、overview 完成确认链）。

### 关键维护规则

- 先确认所属模块，再修改该模块；不要把跨模块行为塞进一个 watcher。
- 页面状态变化通过真实页面验证，不依据猜测的 selector。
- Exercism 的 Turbo 导航不会重新注入 content script，因此持续行为必须监听 Turbo 事件和 DOM 变化。
- Alt 返回路由按 LLM Tab 隔离；来源页关闭后的恢复只接受右侧、同平台的做题页，不使用普通 HTTP 页兜底。
- 快捷键遵循“按住只触发一次、释放立即解锁”；固定超时只做异常恢复，不能用短计时器模拟按键节流。
- 固定 selector、状态定义和快捷键 action 名属于契约；变量名、日志和内部 helper 属于实现细节。
