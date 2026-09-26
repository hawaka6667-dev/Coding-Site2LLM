---
name: chrome-extension-dev
description: 'Chrome 扩展开发与调试工作流。新增或修改 Chrome extension、content script、service worker、manifest、popup/options，或需要用 Chrome MCP 检查真实浏览器行为时使用；完成验证后 reload 扩展并 refresh 所有已打开页面。'
---

# chrome扩展开发

## 适用范围

用于本仓库 Chrome extension 的功能开发、修复和浏览器验证。优先遵循仓库 `helper.md` 的模块边界、验证命令和页面行为约定；本 skill 补充 Chrome MCP 的使用方式与阶段收尾流程。

## 工作流程

1. **确认改动边界**：先定位负责该行为的模块、相关 contract 和最小测试。不要把站点状态判断、页面 selector 或工作流状态复制到不负责它们的模块。
2. **先验证，再探测**：先运行与改动职责匹配的最小测试。需要确认真实页面行为时，再用 Chrome DevTools MCP 检查当前浏览器状态。
3. **使用 Chrome MCP 观察真实状态**：用 `list_pages` 找目标标签页；用 `take_snapshot` 查看可访问页面结构；必要时用 `evaluate_script` 检查 URL、DOM、editor 和页面状态。只对本次改动涉及的页面操作，不猜测 selector 或状态。
	- 工具必须按目的选择：列出当前浏览器标签页时，直接调用 `mcp_chrome_devtoo_list_pages`；检查页面结构和运行态时，调用 `mcp_chrome_devtoo_take_snapshot` 或 `mcp_chrome_devtoo_evaluate_script`。不要把 `mcp_chrome_devtoo_lighthouse_audit` 当作连接检查或 `list_pages` 的替代品；它只用于明确要求的 Lighthouse 审计，并且需要已有的有效 `pageId`。
	- `list_pages` 是 Chrome DevTools MCP 工具，不是 PowerShell/terminal 命令；对用户现有标签页测试时，不要另开 VS Code 集成浏览器替代它。
	- MCP server 重启后重新调用 `list_pages` 获取 pageId；不要复用重启前的 ID。若工具清单有 `list_pages` 但当前会话不能调用，先恢复 MCP 工具暴露/连接，再继续，不要把工具名当 shell 命令运行。
4. **区分页面与扩展上下文**：扩展 reload 会使已注入页面中的旧 content script 上下文失效。`list_console_messages` 不能完整显示 content script 的日志或异常；需要确认注入时，使用该标签页的 `sessionStorage` 写入 probe，再从页面主世界读取。不要用跨同源标签共享的 `localStorage` 做逐标签探测。
5. **修复后重新验证**：运行对应的最小测试；涉及真实 DOM 或路由时，用 Chrome MCP 复核实际页面行为。不要用模拟测试声称已完成真实浏览器 E2E 验证。

### 真实 UI 操作

- 用户要求在当前 Exercism 页面进行真实流程测试时，按 `.lhs-footer .run-tests-btn button` 跑测试，确认测试完成且 `.lhs-footer .submit-btn button` 已启用后即可提交，不必为测试所需的提交重复请求授权；完成后说明提交结果。用户没有要求真实页面测试时，不要自行提交。
- 优先通过最新 `take_snapshot` 的 UID 执行 Chrome MCP 点击。若 MCP 点击失败，检查元素实时状态后再用聚焦按钮并发送 Enter/Space；单独调用 DOM `element.click()` 不足以证明真实提交流程已触发，必须复核页面状态或网络请求。
- Continue 弹窗自动化覆盖 `Continue` 与 `Continue without waiting`，并验证按钮从 `disabled`/`aria-disabled` 转为可用时会立即重查；测试终态应为对话框关闭。

## 阶段收尾：Reload 与 Refresh

每个开发/验证阶段结束时，若本阶段修改了 unpacked extension：

1. 确认相关最小测试通过；测试失败时先修复并重跑，不要 reload 后把失败状态当成验证完成。
2. 使用 Chrome DevTools MCP 的 `reload_extension` 重载扩展。
3. 随后刷新当前浏览器中所有已打开标签页，不按本次改动范围筛选。刷新前重新获取实时标签页列表，通过扩展 Service Worker 单次调用 `chrome.tabs.query`，并行调用 `chrome.tabs.reload`；不得复用先前缓存的 Chrome MCP pageId 或 tabId。
4. 若某个刷新调用未命中或返回标签不存在，重新调用 `list_pages` 获取当前 pageId，按页面 URL 重新定位并重试一次；页面已关闭时不要重建。记录逐标签成功与失败，不能把未命中的命令报告为已刷新。
5. 全部刷新后，用 `list_pages` 确认仍打开的页面已完成导航；对本次改动涉及的页面做必要探测，确认扩展在新页面生命周期中可用。
6. 若用户明确要求 reload，即使当前改动范围不明显，也应执行扩展 reload 并刷新所有已打开标签页；不要处理或改写页面内容。

没有修改 unpacked extension 的纯文档、测试或分析阶段，不必为了形式执行浏览器 reload/refresh。不要把 refresh 扩展成页面内容保护、保存或恢复任务。

## 项目验证命令

按改动职责选择最小验证：

- prompt、页面上下文和反馈清理：`npm run test:unit`
- URL、provider 和站点路由：`npm run test:routing`
- manifest、脚本注入与扩展资源契约：`npm run test:contracts`
- 开发入口和环境检查：`npm run dev:check`

日常开发不要运行 `npm run test:all`，除非用户明确要求全量测试。