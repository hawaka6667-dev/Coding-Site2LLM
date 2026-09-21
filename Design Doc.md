设计文档
//
// 作用   让llm获得充分的原生网站题目信息


主要架构   已实现✔


issue
开启mcp调试，仍然需要到网页手动按确认



流程功能测试
```text
当前编程页面   ctrl shift e触发✔
  -> 抓取题面、代码、可见测试反馈✔
  -> 查找附近的 LLM 标签页✔
  -> 找不到则在左侧创建 DeepSeek✔
  -> 填入并发送内容✔
- LLM：支持 DeepSeek、ChatGPT、Claude、Gemini、DeepAI。✔
```

优化
- Exercism：`Ctrl+Enter` 执行 `Run Tests`、`Continue without waiting`、`Submit`。
- Exercism 自动Mark as complete
- 发给 LLM 内容不包含图片媒体。
- MCP 真实页面验证：升级为高价值调试手段（见「Adapter 架构验证」）
- 快速最小测试
- 修改后自动 Reload 扩展- 修改后自动 Reload 扩展：MCP `reload_extension` 工具（已验证✔，ID `loccbnegdbnncgomcaemokbffafjijpj`）
- chrome直接附带调试模式

/后续
添加更多做题网站支持，如牛客网。。            +测试
优化icon
寻找社区issue然后过去发帖    包括但不限于国内外
自动爬取git issue维护 No newline at end of file No newline at end of file

adapter 诊断工具：scripts/check-adapters.js，输入当前 tab 输出各字段抓取状态
Constraints:

llm每实现一个功能必须要到这边注册




//
原本是直接发ctrl u源码


提交git
