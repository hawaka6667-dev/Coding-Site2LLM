---
name: git-sync-publish
description: 'Git 同步与快速发布工作流。用户要求 git sync、同步并推送，或说 publish、release、发版时使用；本项目默认发布 GitHub Release。'
---

# git sync and publish

## 项目快速发布

用户在本项目要求 `publish`、`release` 或“发版”时，目标默认是仓库配置的 GitHub Release，不要再询问发布平台。优先使用项目脚本，不要重复手工运行脚本已经包含的检查。

### 发布前最小确认

1. 运行 `git status --short --branch` 并确认当前分支是 `main`。
2. 只检查待发布的改动文件；不要遍历无关目录或反复读取项目文档。
3. 确认 `manifest.json` 的版本尚未用于指向其他 commit 的 Git tag。已有 tag 时，按 `helper.md` 版本策略更新版本，再提交。
4. `.codegraph/` 本地状态和 `.feedback/Snipaste_*` 不属于发布内容；不要暂存。CRX、ZIP 和 `.build/coding-site2llm.pem` 也不要提交。

如果改动尚未提交，只暂存已确认属于此次发布的文件，完成必要的定向测试后提交。不要为了发布提交整个工作区。已提交版本在 `main` 且版本号可用时，直接运行：

```powershell
npm run release
```

项目脚本会运行 `test:release`、生成 CRX/ZIP、推送 `main`、创建或推送版本 tag，并上传 CRX 到 GitHub Release。不要先重复运行 `test:release` 或 `package:crx`，除非正在定位失败；脚本会再次执行这些步骤。

### 新 Release 的已知故障恢复

当前 `.build/release.ps1` 用 `gh release view $tag *> $null` 判断 Release 是否存在。PowerShell 的 `$ErrorActionPreference = "Stop"` 会把“release not found”的 stderr 当成终止异常，因此首次创建 Release 时，脚本可能已经成功推送 `main` 和 tag，却在创建 Release 前退出。

遇到该错误时：

1. 不要再次运行 `npm run release`；main 和 tag 通常已经推送，再跑会重复测试和打包并再次失败。
2. 从 `manifest.json` 取得版本，确认对应 tag 已在远端，并确认 GitHub Release 尚不存在。
3. 直接创建 Release 并上传脚本已生成的 CRX：

```powershell
$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
gh release create $tag ".build/Coding-Site2LLM-$tag.crx" --title "Coding Site2LLM $tag" --generate-notes
```

4. 验证 URL 和资产：

```powershell
gh release view $tag --json url,assets --jq '{url: .url, assets: [.assets[].name]}'
```

若 Release 已存在而只需补传或替换 CRX，使用 `gh release upload $tag ".build/Coding-Site2LLM-$tag.crx" --clobber`，不要重新创建 tag。

汇报最终 Release URL、版本、资产、测试结果，以及工作区遗留改动。只有确认远端状态后才报告“已发布”。

## 普通 Git 同步

普通 Git 同步使用 `npm run sync`，只做 pull/rebase → 暂存当前改动 → commit → push，不调整版本、不创建 tag 或 GitHub Release。默认提交说明为 `Sync changes`，也可传入说明：

```powershell
npm run sync -- -Message "Describe the changes"
```

认证、网络或 rebase 冲突会使脚本停止；解决冲突后重新运行，不要 force push。

完成后简要报告 pull、commit、push 结果及未提交改动；普通同步不得混入 Release 操作。