# 开发说明 / Development Notes

本文档说明项目结构、网站职责边界，以及开发和测试流程。

This document describes the project structure, website responsibilities, and
the manual development and testing workflow.

### Exercism支持

这是扩展自己实现的自动化，不是 Exercism 原生功能

-ctrl enter 伪提交热键
-自动mark as complete

## 测试 / Tests 

架构完成后，只做最小测试

整体维护时，过一遍功能测试


### Adapter 架构验证（MCP 调试探针）✔

每个网站一个 adapter 是正确方向 —— 已用真实页面（LeetCode / Codewars）实测验证。

MCP 在本项目里的真正定位是「调试探针」，不是「网页抓取器」：

```text
真实 Chrome → JS Runtime → 页面运行后状态 → 读取框架内部对象
```

可拿到：React/Vue 渲染后内容、Monaco model、CodeMirror instance、动态 DOM、SPA 路由后状态。

已验证链路（与扩展 content script 能力边界基本一致）：

```text
Chrome DevTools MCP → 真实 Tab → evaluate_script() → DOM / window / 编辑器内部 API
```

关键差异：现代 Web IDE 是「DOM=显示层，Memory Model=真数据」，必须分站处理，不能做通用方案：

- LeetCode = React + Monaco Editor → `window.monaco.editor.getModels()`
- Codewars = CodeMirror → `editor.CodeMirror.getValue()`
- ❌ 不能做 `get textarea.value` 这类通用抓取

## 调试探针 / Debug Probe（MCP）

开发流程（替代旧的「猜 selector → reload → 测试 → 失败 → 继续猜」）：

```text
打开真实题目页面
   ↓
MCP evaluate_script
   ↓
验证 document.querySelector(...) / window.monaco.editor... / CodeMirror...
   ↓
确认
   ↓
复制到 worker/adapters.js
```

以后网站改版（DOM 变化、编辑器替换）时，用 MCP 直接跑诊断，不需要猜。

下一步方向：
- 建 `scripts/check-adapters.js`（或 `adapter-debug.html`）：输入当前 tab，输出各字段抓取状态（title / description / editor / code / language）。
- 用 MCP 做 browser integration test（`tests/leetcode.test.js` 等），而不是普通 unit test。

## 自动 Reload / Automatic Reload

### 方案：MCP `reload_extension`（官方，已验证 ✔）

chrome-devtools-mcp 官方提供扩展管理工具，其中 `reload_extension` 可直接刷新未打包扩展（内部实现为重新安装扩展路径，等效于 chrome://extensions 的刷新按钮）。

| 工具 | 功能 |
|------|------|
| `list_extensions` | 列出所有扩展（含 ID、版本、启用状态） |
| `reload_extension <id>` | 按 ID 重新加载未打包扩展 |
| `install_extension <path>` | 从路径安装扩展 |
| `trigger_extension_action <id>` | 触发扩展默认动作 |

扩展 ID：`loccbnegdbnncgomcaemokbffafjijpj`（Coding Site2LLM）

工作流：

```text
改代码 → AI 调 reload_extension → 扩展立即刷新
```

### 为什么不用手搓 HTTP 方案

早期尝试的 `dev-loop.js`（已删除）手搓 HTTP `/json/list` 端点定位 service worker，但 Chrome 153 不暴露该端点（返回空），刷新失败。

chrome-devtools-mcp 走的是 Puppeteer 的 CDP 协议（Target 域），不依赖 HTTP `/json` 端点，因此能正常访问扩展并刷新。

### 说明

`reload_extension` 等扩展工具是 chrome-devtools-mcp **官方自带**（Extensions 分类），连接 MCP 后即可用，无需额外配置。

