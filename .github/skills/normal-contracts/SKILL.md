---
name: normal-contracts
description: 'Coding Site2LLM 项目开发、调试、评审或验证时使用：按 helper.md 落实模块边界、最小测试、Chrome MCP 和扩展刷新，并核对完成证据。'
---

# 普通项目合同

仅适用于本仓库；按 `helper.md` 和相关专项 skill 执行。

1. 不检查无意义 `git status --short`
2. 跑最小相关测试；状态变化测完整闭环。
3. 新建、移动或重划分 `src/worker/state/`、`src/worker/workflows/` 中的 owner 模块时，同步顶部 `@machine` header：`file` 写实际 dist JS 路径，`role` 说明职责，`owns` 与 `does_not_own` 划清边界，`contract` 写可验证的不变量。职责表述须核对实现与测试，不只写在文档或依赖读者推断。


结束时bulletin