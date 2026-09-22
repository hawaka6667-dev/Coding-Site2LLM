# Coding Site2LLM

> 官方技术文档 / POC 技术说明书 / Spec

这份文档的用途不是记录每一次开发过程，而是让两类读者快速恢复状态：

- 人：快速恢复项目上下文，知道下一步应该改哪里、测什么。
- LLM：快速恢复技术状态，知道哪些行为是契约，哪些只是实现细节。


## 0. 开发者的话（其他开发者可以改这里）
我是一边刷题一边开着vs搞开发，所以默认要打开chrome-dev-tool mcp（这个有问题退出简报），以及显式提醒我点击浏览器确认，改完功能默认reload一下扩展

因为我就在刷题，当场测试很便利，而且可能页面上就留有测试素材，因此开发时只需考虑快速实现就行
要么利用我的页面，要么ctrl n自己搞一个然后用完关闭

## 1. 项目定位

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

LLM 页面：等待用户操作
   ├─ 未发生复制：Alt+Q 直接回到原 code Tab
   └─ 发生过复制：Alt+Q 回到原 code Tab，回填复制文本并触发 Ctrl+Enter
```

| 文件 | 职责 |
| --- | --- |
| `worker/extract_coding_site_context_with_site_adapters.js` | 站点 adapter、页面上下文提取、prompt 清理和 Exercism 页面自动化 |
| `worker/find_llm_tab_and_insert_prompt.js` | 查找目标 LLM Tab 并插入 prompt |
| `worker/inject_scripts_and_control_coding_page.js` | 向编程页面注入脚本并控制页面动作 |
| `worker/route_coding_page_and_build_llm_prompt.js` | URL 路由、上下文路由和 prompt 组装 |
| `worker/run_coding_context_to_llm_workflow.js` | 串联从编程页面到 LLM 页面的完整传输，并读取用户选择的 provider |
| `worker/llm_copy_tracker.js` | 监听 LLM 页面真实 copy 事件并通知 service worker |
| `worker/exercism_overview_content_scripts/open_exercise_in_editor.js` | Exercism overview 页 content script：判定是否直接进入编辑页，并声明它自己的开关 |
| `worker/exercism_overview_content_scripts/auto_mark_exercise_complete.js` | Exercism overview 页 content script：出现 `Mark as complete` 时请求 service worker 走确认链 |
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
- 按页面实际状态执行：`Run Tests`（仅当按钮可用）→ 等待 `Submit` 变为可用 → `Submit`。
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

overview 专属脚本集中在 `worker/exercism_overview_content_scripts/`：只跑 overview 页（manifest 用 `exclude_matches` 排除 `/edit`，编辑页由根目录的 `content.js` 负责）。两个文件互不依赖：`open_exercise_in_editor.js` 决定去不去编辑页，`auto_mark_exercise_complete.js` 只负责在 `Mark as complete` 出现时请求确认链；`Mark as complete` 的匹配条件两边各写一份，避免隐式的加载顺序依赖。

## 5.1 扩展面板与开关

点击扩展图标打开 popup（`action.default_popup`），里面是「发送上下文」按钮和 Exercism 跳转开关。开关默认开启，键名 `exercismOpenNewExerciseInEditor`，声明在 `worker/exercism_overview_content_scripts/open_exercise_in_editor.js`，由 `popup/popup.js` 写入 `chrome.storage.local`。

- 该开关是**临时性质**：用来决定正式版是否保留这个跳转行为，删掉时只需移除判断和 popup 里对应控件。
- 设置变化通过 `chrome.storage.onChanged` 即时生效，不必刷新已打开的页面。
- 注意 side effect：`default_popup` 会接管图标点击，`chrome.action.onClicked` 不再触发。因此发送上下文改由 popup 按钮或 `Alt+Q` 触发；`chrome.action.onClicked` 监听器保留但处于休眠状态，删掉 popup 即可恢复原来的单击发送。
- popup 的 `LLM provider` 下拉框使用 `selectedLlmProvider` 保存选择，默认值是 `DeepSeek`。发送上下文时只查找所选 provider 的已有标签页；找不到时在当前窗口创建该 provider 的标签页，不会因为附近存在其它 LLM 标签页而改用其它 provider。
- 从 code 页用 `Alt+Q` 成功发送后，扩展记录来源 code Tab 和目标 LLM Tab。LLM 页再次按 `Alt+Q` 总是回到来源 Tab：如果本次 LLM 页面没有发生过 `copy` 事件，只回跳、不修改代码；如果发生过复制，则回填复制文本并触发 `Ctrl+Enter`。不能用剪贴板当前是否非空代替 copy 事件，因为那可能是之前遗留的内容。

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

