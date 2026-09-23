# Coding Site2LLM
> 官方技术文档 / POC 技术说明书 / Spec

这份文档的用途不是记录每一次开发过程，而是让两类读者快速恢复状态：

- 人：快速恢复项目上下文，知道下一步应该改哪里、测什么。
- LLM：快速恢复技术状态，知道哪些行为是契约，哪些只是实现细节。


## 0. 开发者的自动化要求（其他开发者可以改这里）
以下是项目开发自动化的硬性流程，不依赖开发者临时提醒：

1. 每个开发环节开始时，必须先打开并使用 Chrome DevTools MCP；MCP 不可用时在简报中明确说明并停止真实页面验证。
2. 需要浏览器确认时，必须明确提醒开发者点击确认。
3. 功能修改完成后，必须 reload 未打包扩展，并按需刷新相关页面。
4. 新增功能时默认递增补丁版本 `0.01`：例如 `0.4.0` 变为 `0.4.1`，并重新打包到对应的 `.build/v<version>/` 目录。
5. 纯修复、文档修改和测试修改不自动递增版本；如果一次修改同时新增功能和修复问题，按新增功能递增。

因为我就在刷题，当场测试很便利，而且可能页面上就留有测试素材，因此开发时只需考虑快速实现就行
要么利用我的页面，要么ctrl n自己搞一个然后用完关闭

.feedback 是项目自动消费的反馈栈：只有用户将某条 feedback 推入聊天框后，才处理这一条；不得扫描、归档或修改其它 feedback。

用户推入聊天框的 feedback 已验证解决后，只将这一条移到 `.feedback/old/`（相当于 pop），不要删除，也不要顺手处理其它截图或说明。

环节结束后，自己看一下要不要更新helper

## 1. 项目定位

Coding Site2LLM 是一个 Chrome 扩展。它从在线编程网站的当前题目页读取已有上下文，组装成提示词，并将提示词插入用户已经打开的 LLM 页面。

核心原则：

1. 扩展是**上下文传输层**，不负责替用户分析题目，也不重写用户意图。
2. 每个编程网站使用独立 adapter。网站路由、题目内容、编辑器和测试反馈都由对应站点负责提取。
3. 只传输对解决当前题目有用的内容：题目、代码、语言和测试反馈；过滤 editorial、SEO/meta 文本、媒体和性能排名噪声。
4. Exercism 的提交辅助是扩展自己的页面自动化，不是 Exercism 原生功能。
5. 其它 HTTP(S) 网页使用 `activeTab` 读取当前页面的原始响应源码，作为 Ctrl+U 源码兜底；`view-source:` 页面本身仍拒绝处理。

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

LLM 页面：等待用户操作
   ├─ 未发生复制：默认快捷键 Alt+Q 直接回到原 code Tab
   └─ 发生过复制：默认快捷键 Alt+Q 回到原 code Tab，回填复制文本并提交
                    ├─ Exercism：用户 Run Tests / LLM 回填 → 等待 Submit 可用 → Submit
                    └─ 其它站点：兼容路径派发 Ctrl+Enter
```

| 文件 | 职责 |
| --- | --- |
| `worker/extract_coding_site_context_with_site_adapters.js` | 站点 adapter、页面上下文提取、prompt 清理和 Exercism 页面自动化 |
| `worker/find_llm_tab_and_insert_prompt.js` | 查找目标 LLM Tab 并插入 prompt |
| `worker/inject_scripts_and_control_coding_page.js` | 向编程页面注入脚本并控制页面动作 |
| `worker/route_coding_page_and_build_llm_prompt.js` | URL 路由、上下文路由和 prompt 组装 |
| `worker/run_coding_context_to_llm_workflow.js` | 串联从编程页面到 LLM 页面的完整传输，并读取用户选择的 provider |
| `worker/llm_copy_tracker.js` | 监听 LLM 页面真实 copy 事件并通知 service worker |
| `worker/exercism/auto_submit_after_manual_run.js` | Exercism 编辑页监听用户 Run Tests，并复用 service worker 的提交链 |
| `worker/exercism/open_exercise_in_editor.js` | Exercism overview 页 content script：判定是否直接进入编辑页，并声明它自己的开关 |
| `worker/exercism/auto_mark_exercise_complete.js` | Exercism overview 页 content script：出现 `Mark as complete` 时请求 service worker 走确认链 |
| `popup/popup.html` / `popup/popup.js` | 扩展 popup：Exercism 开关 + 发送上下文按钮 |
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
- 用户直接点击 `Run Tests` 后，编辑页脚本通知 service worker；扩展跳过重复测试，继续等待通过并自动点击 `Submit`。
- 按页面实际状态执行：`Run Tests`（仅当按钮可用）→ 等待 `Submit` 变为可用 → `Submit`。
- LLM 回填代码后复用同一套测试与提交 adapter；不依赖页面是否接受扩展伪造的 `Ctrl+Enter`。
- 同一 tab 的提交请求共享一个进行中的 promise，避免手动点击、快捷键和 LLM 回填同时触发重复提交。
- 页脚是稳定锚点：`.lhs-footer .run-tests-btn button` / `.lhs-footer .submit-btn button`。不要按文字匹配按钮，tab 栏里也有 `Tests`，结果面板里还有第二个 `Submit`。
- `Submit` 的可用条件是「最近一次 run 通过」且「当前文件与该次提交一致」，所以提交前必须等它变为可用，不能用固定延时。
- `Continue without waiting` 属于**提交之后**的 automated feedback 弹窗，不是编辑页 run 流程的一部分。
- 提交成功后，可按页面确认链执行 mark as complete。

overview 页还有一条独立行为：题目**还有事可做**时，默认直接进入 `<exercise>/edit`。判定顺序就是契约：

| overview 状态 | 行为 |
| --- | --- |
| `available`（从未开始） | 进 `<exercise>/edit` |
| in progress，页面上没有可用的 `Mark as complete` | 进 `<exercise>/edit` |
| in progress，页面上有可用的 `Mark as complete` | 留在 overview，交给 mark-complete 确认链 |
| 其它（`completed`、无法判定） | 留在 overview |

- `available` 的判断依据只能是 `[data-react-id="student-open-editor-button"]` 的 `data-react-data.status`。已开始的题目页上，CTA 按钮文字**仍然**是 `Start in editor`，`.action-box.pending` 也仍然存在，所以按钮文字和 action-box class 都不能用来区分。
- in progress 有两个信号：`data-react-data.status` ∈ {`started`, `iterated`, `in_progress`}，或页面上的小 status 容器出现 `In progress` 文案。后者只扫 `[class*="status"|"badge"|"pill"|"tag"]` 里可见且文本长度 ≤ 40 的节点，避免题目说明和 track 侧栏误匹配。
- `Mark as complete` 只在提交之后出现，所以它区分的是「overview 上已无事可做」和「正在等确认」。它出现过一次就会被记住，避免点击瞬间按钮消失或变灰导致页面被跳走。
- 真实 status：`available` → `started` → `iterated`（已提交未完成）→ `completed`；`completed` 是终态，永远留在 overview。
- 打开 `/edit` 会把题目置为 `started`，不会弹回 overview，所以跳转是单向的。每个 tab 每个题目只跳一次（sessionStorage 守卫），避免极端情况下死循环，同时保留 Back 回 overview 的能力。
- Exercism 用 Turbo 做站内跳转，content script 不会重新注入，所以这里同时监听 `turbo:load` / `turbo:render` 和 DOM 变化。

Exercism 专属脚本集中在 `worker/exercism/`：只跑 overview 页的脚本由 manifest 用 `exclude_matches` 排除 `/edit`。编辑页由根目录的 `content.js` 负责快捷键桥接，由 `worker/exercism/auto_submit_after_manual_run.js` 负责监听用户的 Run Tests。两个 overview 文件互不依赖：`open_exercise_in_editor.js` 决定去不去编辑页，`auto_mark_exercise_complete.js` 只负责在 `Mark as complete` 出现时请求确认链；`Mark as complete` 的匹配条件两边各写一份，避免隐式的加载顺序依赖。

## 5.1 扩展面板与开关

点击扩展图标打开 popup（`action.default_popup`），里面是「发送上下文」按钮和 Exercism 跳转开关。开关默认开启，键名 `exercismOpenNewExerciseInEditor`，声明在 `worker/exercism/open_exercise_in_editor.js`，由 `popup/popup.js` 写入 `chrome.storage.local`。完整的 Exercism 功能开关位于 Options 页面，并统一保存在 `chrome.storage.local`。

- 该开关是**临时性质**：用来决定正式版是否保留这个跳转行为，删掉时只需移除判断和 popup 里对应控件。
- 设置变化通过 `chrome.storage.onChanged` 即时生效，不必刷新已打开的页面。
- 注意 side effect：`default_popup` 会接管图标点击，`chrome.action.onClicked` 不再触发。因此发送上下文改由 popup 按钮或快捷键触发；快捷键在 Options 页面中修改，而不是在 Chrome 的扩展快捷键设置中修改。`chrome.action.onClicked` 监听器保留但处于休眠状态，删掉 popup 即可恢复原来的单击发送。
- popup 的 `LLM provider` 下拉框使用 `selectedLlmProvider` 保存选择，默认值是 `DeepSeek`。发送上下文时只查找所选 provider 的已有标签页；找不到时在当前窗口创建该 provider 的标签页，不会因为附近存在其它 LLM 标签页而改用其它 provider。
- Options 页面提供 `Ice Cyan`、`Warm Ivory`、`Mint` 和 `Lemon` 四种浅色 icon skin，选择保存在 `iconTheme`，由 service worker 即时更新工具栏图标；默认值是 `ice-cyan`。
- `send-context` 和 `smart-return` 的默认快捷键都由 Options 页面直接保存到 `codingSite2LlmShortcuts`，默认都是 `Alt+Q`。快捷键采用 Immersive Translate 式输入框：聚焦后按 `Ctrl`、`Alt`、`Shift` 或 `Meta` 加一个非空白可打印字符即可修改，例如 `Ctrl+,`、`Alt+.`、`Shift+/` 或全角标点，也可以 Remove 或恢复 Default；不依赖 Chrome 原生快捷键管理页。coding 页只匹配 `send-context`，LLM 页只匹配 `smart-return`，由 `worker/keyboard_shortcuts.js` 转发给 service worker。旧版 `run-workflow` 配置会在读取时兼容迁移。
- 从 code 页用默认快捷键 `Alt+Q` 成功发送后，扩展记录来源 code Tab 和目标 LLM Tab。LLM 页再次按当前快捷键总是回到来源 Tab：如果本次 LLM 页面没有发生过 `copy` 事件，默认只回跳；如果 LLM 的复制按钮没有派发 DOM `copy` 事件，则读取当前剪贴板，并且只有内容看起来像代码时才回填，避免把遗留的普通文本误提交。明确记录到的复制文本优先使用。
- 这条来源/目标路由持久保存在 `chrome.storage.local`（同时写入 session storage），所以 service worker 被回收或扩展重启后，快捷键循环仍能恢复。

这些行为属于扩展自己的自动化；页面结构变化时，应通过真实页面重新验证，不应假设 Exercism 提供稳定的内部 API。

## 5.2 快捷键技术链与参考项目

快捷键不是 Chrome 原生 `commands`，而是扩展支持页面里的 page-local bridge。原因是 Chrome 的原生快捷键可以由用户在扩展管理页修改，但 Options 页面不能可靠地把它当作普通设置写入；本项目需要让两个动作共享默认键位、分别编辑，并且按当前页面决定动作。

当前技术链如下：

```text
Options 页面
   ↓ 聚焦 readonly input，捕获 keydown
   ↓ 验证修饰键 + 一个非空白可打印字符，格式化为 Ctrl/Alt/Shift/Meta+Key
chrome.storage.local: codingSite2LlmShortcuts
   ├─ send-context: 默认 Alt+Q
   └─ smart-return: 默认 Alt+Q
   ↓
支持页面注入 worker/keyboard_shortcuts.js
   ↓ 读取当前页面对应的动作配置
   ├─ coding host: send-context
   └─ LLM host: smart-return
   ↓ chrome.runtime.sendMessage({ type: "keyboard-shortcut", command })
service worker: worker/run_coding_context_to_llm_workflow.js
   ├─ send-context → runWorkflow()
   └─ smart-return → returnToCodingPage(tab)
```

配置层和执行层必须保持分离：`send-context` / `smart-return` 是稳定的动作名，`Alt+Q` 只是可替换的输入绑定。这样可以让两个动作暂时使用同一个键，也可以以后分别改成不同键，而不需要改 workflow 逻辑。Popup 只读取 `send-context` 显示快捷键，并监听 `chrome.storage.onChanged`；Options 的 Reset 同时恢复两个动作。旧版 `run-workflow` 配置只作为读取时的迁移来源，保存后不再写回旧键。

实现和排错时按这条顺序检查：

1. Options 是否显示两个动作，并且每个 input、Remove、Default 的 id 与动作名一致。
2. `codingSite2LlmShortcuts` 是否只包含两个受支持动作；修改一个动作不能覆盖另一个动作。
3. coding 页和 LLM 页是否分别加载 `keyboard_shortcuts.js`，并且只匹配当前页面对应的动作。
4. `keydown` 是否在保存完成后再失焦，是否阻止重复触发和页面默认行为。
5. service worker 是否收到正确的 `command`，再检查 `runWorkflow` 或 `returnToCodingPage` 本身。
6. reload 未打包扩展后刷新已有 coding/LLM 页面；旧页面里的 content script 不会自动获得新的扩展上下文。

### 参考一：Immersive Translate

[Immersive Translate 官网](https://immersivetranslate.com/) 和其 [GitHub 发布仓库](https://github.com/immersive-translate/immersive-translate)适合作为交互参考：快捷键输入框应该是一个明确的编辑状态，用户聚焦后直接按键，界面给出保存、清除、恢复默认和错误反馈；修改快捷键不应要求用户理解 Chrome 的扩展快捷键管理页。该仓库当前主要用于发布和反馈，公开仓库不包含完整产品源码，因此这里只借鉴交互与配置体验，不复制实现代码。

对本项目的具体借鉴：

- 用 action label 区分“发送上下文”和“返回 coding 页”，不要把两个行为只写成一个含糊的 `run-workflow`。
- 输入框默认只读，进入焦点后捕获组合键，Escape 取消，保存完成后再退出编辑状态。
- 每个动作拥有自己的 Remove 和 Default；Reset defaults 是全局恢复，不应只恢复普通设置。
- 任何显示快捷键的入口都从同一个 storage key 读取，避免 Popup、Options 和实际监听器各自维护默认值。

### 参考二：Godot Input Map

Godot 的 [Using InputEvent](https://docs.godotengine.org/en/stable/tutorials/inputs/inputevent.html) 和 [InputMap 类文档](https://docs.godotengine.org/en/stable/classes/class_inputmap.html)提供了更适合长期演进的抽象：代码使用动作名，动作再映射到一个或多个输入事件。动作可以在项目设置中配置，也可以运行时重映射；输入事件本身不应散落在业务逻辑里。

对应到本项目：

| Godot 概念 | Coding Site2LLM 概念 |
| --- | --- |
| action name | `send-context` / `smart-return` |
| input event | `Alt+Q`、`Ctrl+D` 等格式化快捷键字符串 |
| InputMap | `codingSite2LlmShortcuts` storage 对象 |
| `Input.is_action_pressed()` | 页面 bridge 根据当前 host 匹配动作并发送 runtime message |
| Project Settings / runtime remap | Options 页面保存、删除、恢复默认 |

Godot 还允许同一个 action 绑定多个输入；这是本项目后续支持备用快捷键时的自然方向。当前先保持每个动作一个字符串，避免引入不必要的冲突解决 UI；如果将来需要多个绑定，应把值升级为数组，并明确“同一页面、同一事件只触发一次”的去重规则。

仓库反馈管理：当前待处理的截图、记录和说明放在 `.feedback/`；某条反馈对应的问题完成并验证后，移动到 `.feedback/old/`，不要删除原始反馈文件。未完成的反馈继续留在顶层，避免把 backlog 误归档。

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
- Exercism overview → `/edit` 的跳转判定表（`available`、以及 in progress 但没有可用的 `Mark as complete` 时跳转；有 `Mark as complete` 和 `completed` 留在 overview），并且每个 tab 每个题目只跳一次。

站点 selector、编辑器实现或 SPA 路由变化时，用 Chrome DevTools MCP 重新探测真实页面。旧 smoke test 仅保留兼容性；完整扩展 workflow 由单元和契约测试覆盖。

## 8. 开发与刷新流程

1. 修改对应的 adapter 或 workflow 文件。
2. 先运行职责对应的最小测试：核心功能用 `test:unit`，路由用 `test:routing`，扩展能力用 `test:contracts`，移动文件或配置用 `test:setup`。
3. 使用 Chrome DevTools MCP 在真实页面运行探针，确认页面 DOM、编辑器和测试反馈。
4. 使用 Chrome DevTools MCP 的官方 `reload_extension` 刷新未打包扩展。
5. 刷新编程页面：reload 扩展后旧页面里的 content script runtime 已失效，`Ctrl+Enter` 会静默失败；刷新后 content script 才是新版本。
6. 在编程页面和目标 LLM 页面各验证一次端到端传输。

`tests/deprecated/browser-smoke.test.js` 和 `npm run smoke` 保留用于兼容旧的
HTTP remote-debugging 流程，现已 deprecated；不要把它作为默认页面验证入口。

当前未打包扩展 ID：`loccbnegdbnncgomcaemokbffafjijpj`。

`reload_extension` 通过 CDP 的 Target 能力刷新扩展，不依赖自制的 HTTP `/json` 调试循环。项目不保留旧的 `dev-loop.js` 方案。

## 8.1 how to图标快速制作

图标改动按“一个 SVG 源稿 → 批量导出 PNG”的流程做，不要为每个尺寸单独画一遍，也不要把完整预览页截图当成图标文件。

1. 先改一个 `viewBox="0 0 128 128"` 的 SVG 源稿，确保 128px 和 16px 预览都能辨认。
2. 只保留必要的颜色和粗线条；Chrome 工具栏 16px 下，细描边、文字和复杂渐变都会消失。
3. 用本机 SVG 转 PNG 工具一次生成 `icons/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`。优先使用已有的 `magick` / `sharp` / 设计工具导出，不要逐个浏览器截图。
4. 如果只能用 Chrome 截图，必须截取 SVG 元素本身，不要截整页；Chrome 的设备像素比可能是 `1.25`，导出后要统一缩放到精确的 `16x16`、`32x32`、`48x48`、`128x128`。
5. 用下面的命令快速检查尺寸，再运行对应的最小测试：

```powershell
Add-Type -AssemblyName System.Drawing
Get-ChildItem .\icons\icon*.png | ForEach-Object {
   $image = [System.Drawing.Image]::FromFile($_.FullName)
   try { "$($_.Name): $($image.Width)x$($image.Height)" }
   finally { $image.Dispose() }
}
npm run test:contracts
```

`manifest.json` 已固定使用这四个 PNG 路径，通常不需要改 manifest。完成后用 Chrome DevTools MCP 的 `reload_extension` 刷新扩展，再刷新当前页面；图标缓存不更新时关闭并重新打开扩展管理页。

## 9. 当前边界与后续方向

当前明确不做：

- 通用的跨网站编辑器抓取器。
- 在扩展内生成、总结或改写解题请求。
- 把 MCP 调试脚本当作生产运行时依赖。

可选的后续工作：

- 增加统一的 adapter 诊断输出，展示 title、description、editor、code、language、feedback 各字段的状态。
- 为各站点增加独立的 browser integration test。
- 当站点支持范围扩大后，为 adapter 输出建立显式 schema 校验。

