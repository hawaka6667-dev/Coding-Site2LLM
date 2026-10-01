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

用户在本项目要求 `publish`、`release` 或“发版”时，目标默认是仓库配置的 GitHub Release，不要再询问发布平台。直接使用项目发布脚本；不要在运行脚本前手工检查分支、工作区、版本或 tag，也不要手工重演脚本已实现的步骤。

### 发布流程

1. 直接运行 `npm run sync`。
2. 只有 `sync` 成功后，再运行 `npm run release`。

`publish` 就是 `sync` 后接 `release`

```powershell
npm run sync
npm run release
```

`release.ps1` 会自行验证当前分支为 `main`、工作区无未提交变更、GitHub CLI 已认证，并检查版本 tag 是否指向当前 commit；之后运行 `test:release`、打包 CRX/ZIP、推送 `main` 和版本 tag，再创建或更新 GitHub Release 并上传 CRX。不要预先重复这些检查、手动递增版本，或另行运行 `test:release` / `package:crx`。

遇到任一脚本失败、认证问题或 Git 冲突时，立即停止并报告脚本输出，不自行覆盖、丢弃或 force push。简报
