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

发布完成后汇报 Release URL、版本、资产和测试结果。

## 普通 Git 同步

普通 Git 同步使用 `npm run sync`，只做 pull/rebase → 暂存当前改动 → commit → push，不调整版本、不创建 tag 或 GitHub Release。默认提交说明为 `Sync changes`，也可传入说明：

```powershell
npm run sync -- -Message "Describe the changes"
```

认证、网络或 rebase 冲突会使脚本停止；解决冲突后重新运行，不要 force push。

完成后简要报告 pull、commit、push 结果及未提交改动；普通同步不得混入 Release 操作。