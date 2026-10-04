---
name: chrome-extension-dev
description: 'Chrome 扩展开发与调试工作流。新增或修改 Chrome extension、content script、service worker、manifest、popup/options，或需要用 Chrome MCP 检查真实浏览器行为时使用；完成验证后 reload 扩展，网页刷新由开发者负责。'
---

# chrome扩展开发

## 适用范围

用于本仓库 Chrome extension 的功能开发、修复和浏览器验证。优先遵循仓库 `helper.md` 的模块边界、验证命令和页面行为约定；本 skill 补充 Chrome MCP 的使用方式与阶段收尾流程。

## 工作流程

1. list_pages不了就restart mcp，不得出现不停用其他命令死循环不解决问题的情况出现
3. **使用 Chrome MCP 观察真实状态**：用 `list_pages` 找目标标签页；用 `take_snapshot` 查看可访问页面结构；必要时用 `evaluate_script` 检查 URL、DOM、editor 和页面状态。只对本次改动涉及的页面操作，不猜测 selector 或状态。
	- 工具必须按目的选择：列出当前浏览器标签页时，直接调用 `mcp_chrome_devtoo_list_pages`；检查页面结构和运行态时，调用 `mcp_chrome_devtoo_take_snapshot` 或 `mcp_chrome_devtoo_evaluate_script`。不要把 `mcp_chrome_devtoo_lighthouse_audit` 当作连接检查或 `list_pages` 的替代品；它只用于明确要求的 Lighthouse 审计，并且需要已有的有效 `pageId`。
	- `list_pages` 是 Chrome DevTools MCP 工具，不是 PowerShell/terminal 命令；对用户现有标签页测试时，不要另开 VS Code 集成浏览器替代它。
	- MCP server 重启后重新调用 `list_pages` 获取 pageId；不要复用重启前的 ID。若工具清单有 `list_pages` 但当前会话不能调用，先恢复 MCP 工具暴露/连接，再继续，不要把工具名当 shell 命令运行。
	- 只有 `list_pages` 成功返回空列表时，才能报告“没有可访问标签页”。若 Chrome MCP 未连接、工具不可调用或请求报连接错误，应明确报告“MCP 未连接”，不得推断 Chrome 没有页面；此时停止 snapshot、evaluate、reload 和 refresh 操作。`No page found` 只说明本次 pageId 操作没有找到页面，不等于成功列出空页面，也不能单独用来判断连接状态；先恢复连接并重新调用 `list_pages`。
4. **区分页面与扩展上下文**：扩展 reload 会使已注入页面中的旧 content script 上下文失效。`list_console_messages` 不能完整显示 content script 的日志或异常；需要确认注入时，使用该标签页的 `sessionStorage` 写入 probe，再从页面主世界读取。不要用跨同源标签共享的 `localStorage` 做逐标签探测。
5. **修复后重新验证**：运行对应的最小测试；涉及真实 DOM 或路由时，用 Chrome MCP 复核实际页面行为。不要用模拟测试声称已完成真实浏览器 E2E 验证。

### 真实 UI 操作

- 允许写入答案、提交和切换题目和点击弹窗和自主打开关闭页面等各种复杂操作，因为任务是快速实现
- 快速开发优先，别搞ceremony，这里不存在需要处理敏感数据的情况，先跑通 causal chain 再写 tests。

## 阶段收尾：Reload 与 Refresh

每个开发/验证阶段结束时，若本阶段修改了 unpacked extension：

先确认 Chrome MCP 已连接，并通过 `list_pages` 成功获取当前标签页。若 MCP 未连接或无法成功列出标签页，停止 reload/refresh 并如实报告连接阻塞；不得把连接失败描述为没有可访问页面，也不得伪造已完成的浏览器刷新。

使用 Chrome DevTools MCP 的 `reload_extension` 重载扩展。

网页刷新由开发者负责。不要自动 refresh、reload 或导航任何已打开网页；需要验证新注入脚本时，告知开发者手动刷新相关页面，之后再通过 `list_pages` 和页面检查工具复核结果。


## 项目验证命令

跑通 causal chain之前不要写 tests；否则 test suite 可能成为错误模型的锁

按改动职责选择最小验证：

- prompt、页面上下文和反馈清理：`node --test tests/worker/context-extraction.test.js`
- 站点 URL 和 adapter 识别：`node --test tests/routing/site-adapters.test.js`
- LLM provider 选择和位置：`node --test tests/routing/llm-provider-selection.test.js`
- coding tab 和 editor targeting：`node --test tests/routing/coding-tab-selection.test.js tests/routing/editor-targeting.test.js`
- return route 和 Smart Return：`node --test tests/worker/return-routing.test.js tests/worker/smart-return-workflow.test.js`
- manifest、脚本注入和资源契约：`node --test --test-name-pattern="injects the shortcut bridge|keeps local resources referenced by extension HTML|keeps extension commands and content scripts registered" tests/global-extension-contract.test.js`
- 开发入口和环境检查：`npm run dev:check`
