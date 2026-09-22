设计文档   -  定位是草案
//
// 作用   让llm获得充分的原生网站题目信息


主要架构   已实现✔
流程功能测试：
当前编程页面   Alt+Q触发✔
  -> 抓取题面、代码、可见测试反馈✔
  -> 查找附近的 LLM 标签页✔
  -> 找不到则在左侧创建 DeepSeek✔
  -> 填入并发送内容✔
- LLM：支持 DeepSeek、ChatGPT、Claude、Gemini、DeepAI。✔


优化
- 仅做快速最小测试
- 发给 LLM 内容不包含图片媒体。
- 日常chrome直接attach调试（见「Adapter 架构验证」）
- 修改后自动 Reload 扩展（agent）

- Exercism：`Ctrl+Enter` 提交
- Exercism: overview 新题目直接进编辑页、自动Mark as complete



/后续
添加更多做题网站支持，如牛客网、ctf。。            +测试
优化icon
自动打包扩展、明确内外扩展文件夹边界，反对flat管理

/维护
寻找社区issue然后过去发帖    包括但不限于国内外
自动爬取git issue维护 No newline at end of file No newline at end of file
adapter 维护专用诊断工具：scripts/check-adapters.js，防止官网更新导致抓取失效
开启mcp调试，仍然需要到网页手动按确认




//
原本是直接发ctrl u源码


