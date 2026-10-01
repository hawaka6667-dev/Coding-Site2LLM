---
name: git-sync-publish
description: 'Git 同步与快速发布工作流。用户要求 git sync、同步并推送，或说 publish、release、发版时使用；本项目默认发布 GitHub Release。'
---

# git sync and publish

## 工作流原则

`sync` 和 `publish` 都是明确的执行请求，不进入确认问答流程、不询问发布平台或提交说明，也不手工重演脚本已实现的 Git 步骤。直接执行对应 npm script；只做脚本前置条件要求的准备。遇到认证失败、冲突或脚本报告的其它阻塞时，停止并报告，不擅自覆盖、丢弃或 force push。

## 普通 Git 同步

用户要求 `sync`、同步并推送时，直接运行：

```powershell
npm run sync
```

`.build/sync.ps1` 已硬编码完整流程：`git pull --rebase --autostash`、`git add -A`、有暂存变更时以默认说明 `Sync changes` 创建提交，最后 `git push`。不要额外逐文件挑选、重复执行这些 Git 命令或弹出确认问题。用户显式提供提交说明时才传给脚本；认证失败或 rebase 冲突时按脚本结果停止。

## 项目快速发布

用户在本项目要求 `publish`、`release` 或“发版”时，目标默认是仓库配置的 GitHub Release，不要再询问发布平台。优先使用项目脚本，不要重复手工运行脚本已经包含的检查。

### 发布流程

1. 确认当前分支为 `main`。从 `src/manifest.json` 读取版本，并确认版本 tag 未指向其它 commit；若已占用，按 `helper.md` 的版本策略递增并验证。
2. 按下方顺序直接运行两个命令；只有 `sync` 成功后才继续 `release`。发布脚本负责 release tests、打包、版本 tag 和 GitHub Release；不要重复运行其内部检查。

`publish` 就是 `sync` 后接 `release`

```powershell
npm run sync
npm run release
```

项目脚本会运行 `test:release`、生成 CRX/ZIP、推送 `main`、创建或推送版本 tag，并上传 CRX 到 GitHub Release。不要先重复运行 `test:release` 或 `package:crx`，除非正在定位失败；脚本会再次执行这些步骤。

发布完成后汇报 Release URL、版本、资产和测试结果。
