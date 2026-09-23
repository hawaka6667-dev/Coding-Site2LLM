# Coding Site2LLM

这是一个 Chrome 扩展：从当前 coding site 提取题目上下文，组装 prompt，并把 prompt 交给用户已打开的 LLM 页面。

这份文档服务两类读者，内容按这两个入口组织：

- **人**：快速恢复项目上下文，知道下一步改哪里、测什么。
- **LLM**：恢复技术状态，知道哪些是模块契约，哪些只是实现细节。

## A. 给人：快速恢复

### 项目边界

扩展是上下文传输层，不负责替用户分析、总结或改写题目。

当前支持的 coding site：Exercism、LeetCode、Codewars，以及其它 HTTP(S) 页面的原始源码兜底。

当前支持的 LLM：DeepSeek、ChatGPT、Claude、Gemini、DeepAI 等。具体 provider 配置以 `background.js` 为准。

### 日常开发入口

| 要改的行为 | 先看 | 最小验证 |
| --- | --- | --- |
| prompt、站点上下文 | `worker/extract_coding_site_context_with_site_adapters.js` | `npm run test:unit` |
| URL 和站点路由 | `worker/route_coding_page_and_build_llm_prompt.js` | `npm run test:routing` |
| Exercism overview 跳转 | `worker/exercism/open_exercise_in_editor.js` | `npm run test:routing` |
| Exercism 完成确认 | `worker/exercism/auto_mark_exercise_complete.js` | `npm run test:contracts` |
| Exercism 编辑页提交 | `worker/exercism/auto_submit_after_manual_run.js` | `npm run test:contracts` |
| 扩展注入和 manifest | `manifest.json`, `content.js`, `worker/` | `npm run test:contracts` |
| 开发环境和文件入口 | `tests/dev-check.ps1`, `package.json`, `manifest.json` | `npm run dev:check` |

### 标准验证顺序

1. 先运行职责对应的最小测试。
2. 需要确认页面事实时，使用 Chrome DevTools MCP 探测真实 DOM、路由和编辑器状态。
3. 修改未打包扩展后，reload 扩展：`loccbnegdbnncgomcaemokbffafjijpj`。
4. reload 扩展后刷新已有 coding/LLM 页面；旧 content script 的 extension context 已失效。
5. 需要用户点击页面按钮时，明确提醒用户确认；不要用猜测的坐标代替确认。
6. 测试完页面后，默认刷新一下页面。

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

`.feedback/` 只处理用户当前推入聊天框的那一条 feedback。验证解决后移动到 `.feedback/old/`，不要顺手处理其它 feedback。

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
npm run session:end     # 测试通过后调用外部桥接命令 reload 扩展
npm run test:all        # 主动做全局代码维护时运行
```

最小回归必须覆盖：支持站点路由、恶意/不支持 URL、prompt 过滤、Exercism `available/started/iterated/completed` 状态、`Exercise Solved` 终态、编辑页提交链和完成确认链。

### 关键维护规则

- 先确认所属模块，再修改该模块；不要把跨模块行为塞进一个 watcher。
- 页面状态变化通过真实页面验证，不依据猜测的 selector。
- Exercism 的 Turbo 导航不会重新注入 content script，因此持续行为必须监听 Turbo 事件和 DOM 变化。
- Alt 返回路由按 LLM Tab 隔离；来源页关闭后的恢复只接受右侧、同平台的做题页，不使用普通 HTTP 页兜底。
- 快捷键遵循“按住只触发一次、释放立即解锁”；固定超时只做异常恢复，不能用短计时器模拟按键节流。
- 固定 selector、状态定义和快捷键 action 名属于契约；变量名、日志和内部 helper 属于实现细节。
