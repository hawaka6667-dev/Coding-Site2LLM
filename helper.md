# Coding Site2LLM

这是一个 Chrome extension：从当前 coding site 提取 problem context，组装 prompt，并把 prompt 交给用户已打开的 LLM page。
以及各种快捷功能

这份文档面向两类读者，内容按这两个入口组织：

- **人**：快速恢复 project context，知道下一步改哪里、测什么。
- **LLM**：恢复 technical context，区分 module contract 与 implementation detail；不得把内容级别上升为设计契约。

## A. 给人：快速恢复

### 项目边界

extension 是 context-transport layer，不负责替用户分析、总结或改写题目。

扩展源码和静态资源集中在 `src/`；TypeScript 编译输出与复制后的运行资源集中在 `dist/`。`dist/` 是 Chrome「Load unpacked」与 CRX/ZIP 打包的唯一根目录，由构建生成并忽略于 Git；不要直接编辑 `dist/`。图标预览页位于 `src/icons/icon-preview.html`，仅供开发使用，构建时排除；构建脚本集中在 `.build/`。仓库根保留测试、文档和开发资料，不把其它开发材料放进 `src/`。

### 规模与语言选择（通用参考）

**一代：小规模直接用 JavaScript。** 模块少、数据关系简单、协作人数有限时，手写 JS 并直接运行即可；省去编译和类型维护成本，开发与调试路径更短。

**二代：规模扩大后用 TypeScript。** 当共享数据契约、模块依赖、协作人数或改动影响范围增长时，用 TS 作为源码，通过类型检查及接口约束辅助协作和重构；编译出的 JS 与 TS 源码分开存放，避免混淆和误改生成文件。是否升级看复杂度和维护成本，不只看文件数量；TS 也不能替代模块边界和测试。

后台核心源码使用 TypeScript：`src/background.ts` 和 `src/worker/**/*.ts` 编译为 `dist/` 中对应路径的 classic-script `.js`，由 Manifest V3 service worker 按 `background.ts` 中的 `importScripts()` 顺序加载。构建会把手写 JavaScript、Manifest 和静态资源复制到 `dist/`，并将 TypeScript 输出写入 `dist/`；不会在 `src/` 生成配对 `.js`。修改扩展源码后，测试脚本会先自动运行 `npm run build:extension`；手动构建用 `npm run build:extension`，只做类型检查用 `npm run typecheck:extension`。`src/worker/` 下由 manifest 直接注册的页面 content scripts 仍是独立 JavaScript，不属于后台核心迁移。

### 用户目标优先

所有 UI、input 和 automation design 先回答 target user 要完成什么，再选择 implementation。不得把 browser default behavior、developer habits、framework constraints 或 future feature plans 当作 user goals。目标明确后，依次确定 user workflow、可接受的 input、error recovery、product language policy，最后才选择 native controls、validation 和 localization mechanism。

当前 target users 是学生和做题者。他们需要在题目、code editor 与 LLM 之间快速切换。supported coding sites、developer 使用的语言和当前 page language 都是 runtime environment，不能被当作 user persona 或 UI language preference。

当前支持的 coding sites：Exercism、LeetCode、Codewars，以及其它 HTTP(S) pages 的 raw-source fallback。

内置 LLM providers：DeepSeek、ChatGPT、Claude、Gemini、DeepAI、Kimi。Options 可添加自定义 HTTP(S) provider，保存在 `customLlmProviders`；按名称选择后，worker 使用保存 URL 的 origin 查找或打开目标标签页。具体内置匹配规则以 `src/worker/configure_supported_coding_sites_and_llm_providers.ts` 为准。

### 日常开发入口

| 要改的 behavior | 先看 | 最小 validation |
| --- | --- | --- |
| prompt、site context | `src/worker/adapters/` | `npm run test:unit` |
| URL routing 和 site routing | `src/worker/route_coding_page_and_build_llm_prompt.ts` | `npm run test:routing` |
| Exercism overview redirect, auto-completion and submitted-window lifecycle | `src/worker/exercism/overview/open_exercise_in_editor.js`, `src/worker/exercism/overview/auto_mark_exercise_complete.js`, `src/worker/exercism/submitted_overview/`, `src/worker/workflows/exercism_workflow.ts` | `npm run test:routing` 和 `npm run test:contracts` |
| Exercism track-list scroll restoration | `src/worker/exercism/preserve_track_list_scroll_position.js` | `npm run test:routing` 和 `npm run test:contracts` |
| Exercism editor bridge and submission | `src/worker/exercism/edit/content.js`, `src/worker/adapters/exercism_edit_adapter.ts`, `src/worker/workflows/smart_return/smart_return_workflow.ts`, `src/worker/workflows/exercism_workflow.ts`, `src/worker/exercism/edit/auto_submit_after_manual_run.js`, `src/worker/exercism/submitted_overview/open_submitted_overview_after_submit.js` | `npm run test:unit` 和 `npm run test:routing` |
| Smart Return route lifecycle and code write-back | `src/worker/workflows/smart_return/`, `src/worker/adapters/` | `npm run test:unit` |
| Codewars Smart Return write-back and full-suite attempt | `src/worker/adapters/codewars_adapter.ts`, `src/worker/workflows/smart_return/smart_return_workflow.ts` | `npm run test:unit` |
| Exercism Continue dialogs | `src/worker/exercism/edit/continue_after_exercism_modals.js`, `tests/exercism/edit/continue-dialogs.test.js` | `npm run test:unit` |
| core workflow operation logs and debug-module refactor | `src/worker/debug/` (planned), `src/worker/diagnostics.js`, `src/worker/workflows/`, `src/worker/exercism/overview/auto_mark_exercise_complete.js` | `npm run test:unit` 和 `npm run test:routing` |
| popup daily-practice entry | `src/popup/daily_practice_providers.js`, `src/popup/popup.js` | `npm run test:unit` |
| SQLBolt Run Query shortcut | `src/worker/sqlbolt/run_query.js`, `src/manifest.json` | `npm run test:unit` 和 `npm run test:contracts` |
| LLM provider options, popup selection and routing | `src/options/options.js`, `src/popup/popup.js`, `src/worker/configure_supported_coding_sites_and_llm_providers.ts`, `src/worker/workflows/run_coding_context_to_llm_workflow.ts` | `npm run test:unit`, `npm run test:routing`, `npm run test:contracts` |
| extension injection、manifest 和页面本地资源 | `src/manifest.json`, `src/options/`, `src/popup/` | `npm run test:contracts` |
| development environment and generated package | `tests/dev-check.ps1`, `package.json`, `src/manifest.json`, `dist/` | `npm run dev:check` |

`dev:check` 检查 repository entry points、manifest 和 Chrome process。浏览器实时状态直接通过 Chrome DevTools MCP 的 `list_pages` 查看；不需要导出、保存或维护快照文件。

### 标准验证顺序

1. 先运行与改动职责对应的 smallest relevant test。
2. 需要确认 page behavior 时，使用 Chrome DevTools MCP 检查真实 DOM、routing 和 editor state；模拟测试不能标为真实浏览器验证。
3. 默认不 reload extension，也不刷新已打开网页；网页刷新由用户管理。只有用户在本轮明确授权时才执行对应操作。
4. 用户明确要求 reload extension 时，使用 Chrome DevTools MCP 的 `reload_extension`；除非用户也明确要求，否则不要刷新页面。
5. 需要用户点击 UI control 时，明确提醒用户确认；不要用猜测的 coordinates 代替确认。

### 测试挂起与超时防护

- 新增或修改 asynchronous tests 时，检查每个 pending Promise 在 test path 上都能 resolve 或 reject；VM/iframe 等 isolated context 使用的 callbacks 和 resolvers 必须显式注入，避免 error 被异步捕获后 test 仍无限等待。
- 测试按功能放在 `tests/worker/`、`tests/routing/` 和 `tests/exercism/`；共享 VM harness 位于 `tests/worker-test-harness.js`。怀疑 Node test hang 时先单独运行对应文件并启用 test-level timeout，例如 `node --test --test-timeout=10000 tests/worker/smart-return-workflow.test.js`；不要为了排查直接运行 `test:all`。
- timeout 用来发现 test 未完成，不等同于证明存在 infinite loop。Synchronous infinite loop 会 block event loop，应使用 external process-level timeout 并检查 CPU usage；pending async Promise 通常表现为 test timeout 或进程仍有 active handles。
- 断言 VM 等 cross-realm values 时，比较明确 fields，或先转换为 host-realm plain objects，避免 prototype mismatch 造成误报。

Every delivered change increments the four-part extension version `major.minor.batch.change` so different builds do not share a release number. Each small change, including fixes, tests, and documentation, increments the final segment by `0.0.0.1` (for example, `0.5.6.0` to `0.5.6.1`). A large one-time batch of changes increments the batch segment by `0.0.1` and resets the final segment to `0` (for example, `0.5.6.3` to `0.5.7.0`). Larger feature or architecture milestones increment the minor segment by `0.1.0.0`; breaking or major milestones increment the major segment by `1.0.0.0`, resetting lower segments to `0`. Historical three-part release tags are treated as having a final segment of `0`. Git tags and GitHub Releases retain the release history.

### 浏览器探测原则

MCP 是 debugging probe，不是 production dependency。先观察 live runtime，再修改 adapter 或 page script。

检查页面切换时，先区分整页 hard navigation 与 SPA/Turbo client-side navigation。后者可在不重建 document、不重新注入 content script 的情况下改变 URL、题目内容和 editor DOM；不能仅凭 tab id 不变或 URL 改变，就假设脚本、页面状态或编辑器已刷新。

跨页面维护路由按题目身份而非完整 URL 判断：同 URL 刷新以及同题的 SPA/Turbo 路由变化都保留维护；身份变化才删除整条路由和旧复制 payload。LeetCode 同一 problem slug 的根页、query/hash 和 `/submissions/...` 属于同题；submission 页面上下文使用 LeetCode adapter 提取，描述面板未挂载时从同源 `/description/` 文档读取题面，并从可见 submission detail 提取 verdict 与 `Last Executed Input`；Smart Return 当前只返回发送时记录的原标签页，不自动寻找同题根页 editor。LeetCode 专用编辑目标选择不属于通用 Smart Return 路由。Exercism overview 与 `/edit` 使用同一 track/exercise 身份；Codewars 使用 kata 与训练语言身份。其它 HTTP(S) 来源按完整 URL 区分。Chromium 的 History API 客户端导航使用 `webNavigation.onHistoryStateUpdated` 探测，并限制在主 frame；该 API 需要 manifest 的 `webNavigation` permission。

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

核心工作流日志的查看位置、关联方式和隐私约束见下方「Debug 追踪」。

执行扩展刷新时，先调用 Chrome DevTools MCP 的 `reload_extension`，再通过扩展 Service Worker 单次批量刷新本次改动影响到的网页；不处理网页内容。

`list_console_messages` 无法完整观察 content script errors。需要确认 content script 是否运行时，从 page context 写入 `sessionStorage` probe，再从 page main world 读取；不要使用会在 same-origin tabs 间共享数据的 `localStorage`。

### 当前开发边界

不做 generic cross-site editor scraper，不在 extension 内生成 solution content，不把 MCP scripts 作为 production runtime dependencies。

popup 的 daily-practice entry 由 `src/popup/daily_practice_providers.js` 的 provider list 驱动。LeetCode 使用当天 UTC date 构造 Daily Question page；Codewars 直接打开 dashboard。新增 coding site 时只需添加 provider configuration，并扩展对应的 contract test。

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

本节同时记录已验证的外部行为约束和当前实现导航。selector、时序、内部状态字段及文件职责都可能变化；修改时应以当前代码和相邻测试核实，不因本节描述而维持旧实现。

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

Exercism 的 `Back to Exercise` 是具体的 Turbo 导航例子：`submitted_overview/open_submitted_overview_after_submit.js` 在编辑页通过 `turbo:before-visit` / `turbo:load` 创建提交后的同题 overview 窗口；`open_exercise_in_editor.js` 也监听 Turbo 生命周期及 DOM 变化。LeetCode 切题后的 Monaco 延迟挂载由 `tests/routing/editor-targeting.test.js` 覆盖。新增或修改导航行为时，测试必须区分整页加载与客户端路由，并验证切换后使用的是当前页面/editor 状态。

快捷键动作是两个独立的 action：

```text
send-context  : coding page -> LLM page
smart-return  : LLM page -> source coding page
```

快捷键桥接脚本注入所有 HTTP(S) 页面，以支持其它页面的 raw-source fallback；popup 按钮仍可通过 `activeTab` 在当前页触发相同的后台 workflow。全站快捷键需要 `*://*/*` host permission；Chrome 内部页和扩展页面不支持注入。

在 coding page 按下 `send-context` 时，若页面有非空鼠标选区，只发送选区原文并跳过整页 context 提取；没有选区时保持原有整页题目 context 发送流程。`smart-return` 不读取选区。

默认均为 `Alt+Q` 和 `Mouse5`，配置保存在 `codingSite2LlmShortcuts`。动作名是业务契约，按键只是可替换的输入绑定。工具栏图标默认主题为 Warm Ivory (`warm-ivory`)。

每个 action 最多有两个独立输入绑定；Options 默认显示 `Alt+Q` 和 `Mouse5`，移除其中一个后可点击 Add 添加第二个自定义绑定。存储值为至多两个字符串组成的数组；读取旧版单字符串时迁移为单元素数组。键盘组合和鼠标侧键 `Mouse4` / `Mouse5` 都是有效绑定。

快捷键等设计必须符合人体工学：一次按键组合在用户释放前只能触发一次。页面侧用 `event.repeat` 和 held 状态拦截长按重复事件；Service Worker 收到 `keyup` 的释放消息后立即解锁，超时只作为释放消息丢失时的异常兜底，不能被当作正常的快捷键间隔。兜底时间应明显长于普通人的按住时长，避免用户仍在按键时再次触发工作流。

LLM 页的返回路由按 `windowId + llmTabId` 保存。一次发送会把当前 coding 页记录为该 LLM 页的当前返回页；来源页关闭后删除该路由和关联复制文本，不跳转到其它标签页；下一次显式发送再建立新路由。

返回路由是用户通过 `send-context`（默认 Alt+Q；popup 使用同一 workflow）明确建立的维护授权，按 `windowId + llmTabId` 关联到发送时的 source tab、URL 和题目身份。硬导航、History API 和 hash 导航都按站点身份比较；同题 URL 变化保留维护，身份变化删除整条路由和旧复制 payload。失效前必须回查 source tab 当前 URL；若它已不同于导航事件 URL，则忽略过期通知。Smart Return 执行前再次比较当前 source 身份，阻止导航事件竞态把旧 payload 写入新题。

| 站点 | 维护身份 | 编辑目标约束 |
| --- | --- | --- |
| LeetCode | `/problems/:slug` 的 slug；忽略 query、hash 与同题子路由 | 通用 Smart Return 只回原 source tab；submission 到编辑器的专用选择策略另行实现 |
| Exercism | track + exercise slug；overview 与 `/edit` 相同 | overview 与编辑页仍是不同页面能力，不能把 overview 当作代码编辑器 |
| Codewars | kata slug + train language | 只能使用同一身份的训练页 |
| 其它 HTTP(S) 来源 | 完整 URL | 不跨 URL 猜测题目身份 |

Smart Return 只激活路由记录的 `sourceTabId`，不按平台、题目身份或标签页位置选择替代页。source tab 关闭或回跳时已不存在，则清除对应路由及复制 payload，不跳转；只有下一次显式 `send-context` 才建立新路由。LeetCode 等站点需要不同编辑目标时，由站点专用逻辑另行实现，不扩展通用路由的候选查找。

Exercism `/edit` 的 Smart Return 使用可见 `.cm-editor .cm-content[contenteditable="true"]`，通过 `execCommand("selectAll")` / `execCommand("insertText")` 和 input/change 事件写入 CodeMirror；不能以直接赋值 `textContent` 作为成功回填，因为这不保证编辑器 model 已更新。插入命令失败时应终止本轮，不提交可能未更新的代码。

### 可复用工作流生命周期

发送、复制、回跳可能在同一 LLM tab 上反复执行。对于有异步状态或可重复调用的 workflow，应按具体风险明确必要的状态转换和成功、失败、取消、无目标等终态；不要求所有 workflow 采用同一状态机。

Smart Return 成功回填后启动的站点测试/提交属于 adapter 的独立工作，不是 ret 的完成条件；ret 不等待它，pending adapter work 也不能阻塞后续 ret。处理并发 route 或 payload 更新时，旧 cycle 不得覆盖新状态或清理新 payload；revision、持久化和 cleanup 的具体实现以当前代码为准。payload 在失败路径上的保留或清理，应由对应实现和测试确认，不从成功路径推定。

同一个 LLM tab 的 Smart Return cycle 应避免彼此重叠，直到 ret 自身的路由校验、来源页激活、回填及必要 cleanup 完成；adapter 的测试/提交不属于这个等待范围。不同 LLM tab 可独立运行。`Web source` 的返回目标按实现和测试确认，不应仅因 URL 相似就猜测替代标签页。

测试范围按本次改动和风险选择。涉及 ret 重复调用或 adapter 时序时，覆盖连续 ret 且 adapter pending 不阻塞下一轮；涉及 route 并发或失败清理时，再覆盖相应竞态和失败路径。单元测试不必为了满足文档而重复跑完整 workflow。

### Debug 追踪

`send-context`、Smart Return 和 Exercism 完成流程使用 `operationId` 关联阶段日志；在扩展 Service Worker 的 DevTools Console 中按 `[CodingSite2LLM]` 查看。当前统一入口是 `src/worker/diagnostics.js`，部分阶段埋点仍位于 workflow 和 content script。日志只记录阶段、结果、平台、tab ID、耗时及脱敏后的上下文摘要，不记录 prompt、题目正文、剪贴板或用户代码；轮询和 DOM 观察只记录状态变化或终态。以后将日志职责迁入 `src/worker/debug/` 前，先在本节明确模块职责与事件契约。

### 模块边界

下表是当前代码的职责导航，不是不可跨越的架构边界。调整职责前沿实际调用链、状态 owner 和相邻测试判断影响；不要为了符合表格而复制逻辑或强行拆分。

| 模块 | 当前主要职责 | 常见协作边界 |
| --- | --- | --- |
| `worker/adapters/*_adapter.ts` | 每个站点独立负责页面提取、过滤、编辑器回写和站点内测试提交 | 其它站点 selector、跨页面导航策略 |
| `route_coding_page_and_build_llm_prompt.js` | URL 路由和 prompt 组装 | 页面自动化和 LLM 交互 |
| `find_llm_tab_and_insert_prompt.js` | 找到指定 provider 并插入 prompt | 站点状态判断 |
| `worker/workflows/smart_return/route_store.ts` | 持久化 Smart Return route、兼容旧存储格式、按 revision 原子更新和消费 payload | Chrome 导航监听、目标选择、编辑器操作 |
| `worker/workflows/smart_return/route_lifecycle.ts` | 接收来源 tab 导航/关闭及 LLM copy 事件，委托 route store 执行维护 | route 存储实现、目标选择、代码写入 |
| `worker/workflows/smart_return/code_transfer.ts` | 读取剪贴板、回填代码，并委托站点 adapter 提交 | route 状态、目标 tab 选择、cycle 调度 |
| `worker/workflows/smart_return/smart_return_workflow.ts` | 协调单个 LLM tab 的 Smart Return cycle、激活路由记录的来源 tab、revision 检查和阶段诊断 | route 存储、导航监听、替代 tab 选择、站点编辑器实现 |
| `worker/diagnostics.js` | 为页面 content script 与 Service Worker 提供脱敏的结构化操作日志及 `operationId` | 记录页面正文、prompt、剪贴板或用户代码；输出高频轮询/DOM 变更日志 |
| `worker/workflows/run_coding_context_to_llm_workflow.ts` | 捕获 coding context、请求 Smart Return 模块建立发送来源 route、选择 LLM 并发送 prompt；维护快捷键锁和 runtime message dispatch | route 持久化实现、Smart Return 回跳与代码写入、Exercism 窗口生命周期 |
| `options/options.js` | 保存 Options 页面设置及用户自定义 LLM provider；provider 名称不能与内置项或其它自定义项重名，地址只允许 HTTP(S) | popup provider 选择和 worker tab 查找 |
| `worker/configure_supported_coding_sites_and_llm_providers.ts` | 定义内置 provider 元数据，并把有效自定义 provider URL 解析为 origin 匹配规则 | 用户设置 UI、prompt 捕获 |
| `worker/llm_copy_tracker.js` | 在 HTTP(S) 页面转发显式复制文本，供已建立的 Smart Return route 使用 | provider 管理、route 存储 |
| `worker/sqlbolt/run_query.js` | 仅在 SQLBolt lesson 的编辑器聚焦时，将 Ctrl+Enter 转发到同一编辑器容器的 `RUN QUERY` 链接 | SQLBolt 页面以外的快捷键、其它站点编辑器 |
| `worker/workflows/exercism_workflow.ts` | 协调 Exercism test-submit、受管 overview 窗口、Mark as complete 和 concepts 刷新 | 页面 selector 和 overview/edit 页面状态判断 |
| `submitted_overview/open_submitted_overview_after_submit.js` | 仅在 edit 页捕获 Submit；提交后的 Turbo 导航目标为同题 overview 或同题 `/edit` 时，按设置请求创建不抢焦点的 overview 窗口，并保留原标签页中的 editor | Chrome 窗口 API、overview 完成和普通 overview 路由 |
| `open_exercise_in_editor.js` | 仅判断 overview 是否进入 `/edit` | `Mark as complete`、提交确认 |
| `auto_mark_exercise_complete.js` | 在 overview URL 发现可用的 `Mark as complete` 并请求完成链；也预先注入 Exercism `/edit` 文档以监听返回 overview 的 Turbo 导航 | 是否进入 `/edit` |
| `auto_submit_after_manual_run.js` | 监听用户 Run Tests 并请求提交链 | overview 跳转和完成按钮 |
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

Exercism 的 Turbo 导航不会按目标 URL 重新注入 Manifest content scripts。编辑页因此也必须预先加载 `auto_mark_exercise_complete.js`；该脚本在 `/edit` 只监听导航，不扫描或请求完成，只有 URL 到达 overview 后才处理按钮。回归测试覆盖 `/edit` → `Back to Exercise` Turbo 导航。

完成请求必须等待 Service Worker 回传完成结果；只有确认完成后才将当前 overview URL 标记为已处理。失败或无响应时按有界退避重试，页面 DOM/Turbo 状态变化及设置重新启用时重新检查；不能把“消息已发出”视为完成，否则临时失败只能靠刷新清除页面内状态。

同一 Exercism 页面上注册的 content scripts 共用扩展隔离世界；不同脚本的顶层 `const` / `let` 名称必须唯一，否则重复声明会阻止脚本解析。`tests/exercism/overview/auto-mark-complete.test.js` 将当前 overview 自动化脚本在共享上下文验证，覆盖该约束。

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

`continue_after_exercism_modals.js` 只检查可见 dialog 中的按钮，支持 `Continue` 与 `Continue without waiting`；除 dialog 子节点变化外，还监听 `disabled` 和 `aria-disabled` 属性变化，以便按钮一变为可用就继续。`tests/exercism/edit/continue-dialogs.test.js` 覆盖延迟启用到关闭 dialog 的状态转换。

自动完成链必须区分 iteration passed 与 exercise completed。`Exercise Solved` 只表示提交的 iteration 通过，不能单独作为完成成功信号；完成链只在 overview 状态为 `completed` 或出现可见的完成结果对话框后返回成功。`tests/exercism/overview/auto-mark-complete.test.js` 覆盖条件按钮出现 → 发起完成请求 → 确认弹窗 → 完成结果输出，并断言结果出现前不刷新 track concepts。

提交后的 overview 生命周期由两个页面脚本与 Service Worker 分工：编辑页脚本拦截同题 `Back to Exercise` Turbo 导航，按 `exercismAutoMarkComplete` 设置请求打开未聚焦 overview，并等待 Service Worker 回执；关闭设置或创建失败时回到 overview。overview 页脚本只在收到 `completed: true` 后请求关闭。Service Worker 先登记创建窗口及 exercise path，再导航其 tab；关闭请求只作用于匹配的受管窗口并清除登记。`auto_mark_exercise_complete.js` 负责发现 `Mark as complete`、请求完成及等待结果。已在未完成的 Booking Up for Beauty 练习实测通过：五项任务通过、提交后受管 overview 自动完成并关闭，session 登记清空；测试分别覆盖页面职责、登记顺序、同题校验、设置 fallback 和错误目标拒绝。

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

Exercism 测试按被测职责选择范围：单元测试可验证局部判断和边界；涉及页面 workflow 或状态衔接的测试，应覆盖相关的 `initial state -> actions/intermediate states -> terminal state` 及必要副作用。不要要求每个页面测试都重复完整流程，也不要用 source structure 断言代替行为验证。

- 涉及状态机或跨模块衔接时，覆盖与改动相关的状态转换，例如 `available -> /edit`、`iterated -> completed` 或 `Run Tests -> Submit`；局部改动不需要无关状态全覆盖。
- 可以 stub 被测范围之外的 DOM、timing 和 Chrome API boundary；对 workflow 测试，保留正在验证的实际流程，避免 mock 掉关键转换本身。
- 断言本次行为的结果和必要副作用。只有覆盖不同风险或边界时才保留重复场景；实际 DOM 和 routing 行为需要浏览器验证，模拟测试不能称为真实浏览器 E2E。

### 测试命令

```powershell
npm run test:unit       # prompt、上下文和反馈清理
npm run test:routing    # URL、provider 和 adapter 路由
npm run test:contracts  # manifest、注入、Exercism wiring 和资源契约
npm run dev:check       # Chrome、MCP、Service Worker、必要页面和文件入口
npm run session:end     # 测试通过后 reload 扩展并刷新已有 coding/LLM 页面
npm run release         # 已提交版本的一键测试、打包、推送、打 tag 和 GitHub Release 发布
```

`npm run release` 仅从 `main` 发布已提交的 manifest version。它一次运行所有 release tests、生成 CRX/ZIP、推送 `main`、创建或复用同名 tag，并创建或更新 GitHub Release。成功后终端回执包含版本、测试状态、CRX 上传路径、ZIP 本地路径和 Release URL；失败时脚本会停止并报告错误。



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

回归范围由改动决定：选择能覆盖本次行为及其关键失败边界的最小测试；只有触及对应路由、prompt 或 Exercism 状态流程时，才扩展到那些场景。

### 关键维护规则

- 先确认所属模块，再修改该模块；不要把跨模块行为塞进一个 watcher。
- 页面状态变化通过真实页面验证，不依据猜测的 selector。
- Exercism 的 Turbo 导航不会重新注入 content script，因此持续行为必须监听 Turbo 事件和 DOM 变化。
- Alt 返回路由按 LLM Tab 隔离；来源页关闭后删除该路由，不恢复到其它标签页，直到下一次 send-context 建立新路由。
- 快捷键遵循“按住只触发一次、释放立即解锁”；固定超时只做异常恢复，不能用短计时器模拟按键节流。
- 外部可观察行为和稳定接口才是契约。selector、状态探测方式、内部变量、日志和 helper 属于实现细节；快捷键 action 名只有在构成稳定外部接口时才按契约维护。
