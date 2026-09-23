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
- 快速最小测试
- 发给 LLM 的内容           兜底源码     不含图片媒体
- attach调试的日常chrome
- agent自动 Reload 扩展

- Exercism：`Ctrl+Enter` 提交
- Exercism: 更快overview 



/后续

符合 搬运→出错改错→在改错→。。→有限改好 这样的设计流程

添加更多做题网站支持，如牛客网、ctf。。            +测试
优化icon
自动打包扩展、明确内外扩展文件夹边界，反对flat管理

/维护
寻找社区issue然后过去发帖    
自动爬取git issue维护 No newline at end of file No newline at end of file
adapter 维护专用诊断工具：scripts/check-adapters.js，防止官网更新导致抓取失效
开启mcp调试，仍然需要到网页手动按确认




//
1版是直接发ctrl u源码

2版：现在是手动筛选，可能需要维护                  建议是 支持网站之外直接发源码↓

未来正确计划应该是 使用内置静态llm或?可选api的llm? 去执行任务↑，用以对付支持网站之外的情况，网站规则改变的情况
                           识别文本                      自己报issue



