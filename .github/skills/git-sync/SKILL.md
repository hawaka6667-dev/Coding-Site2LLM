---
name: git-sync
description: 'Git 同步工作流。用户要求 git sync、同步分支、提交并推送，或希望按 Git 同步插件的 pull → submit/commit → push 顺序操作时使用。'
---

# git sync

## 目标

按 Git 同步插件式的顺序完成同步：先 pull 远端更新，再 submit（在此项目中指创建 Git commit），最后 push 到当前分支的 upstream。不要把 GitHub Release、打 tag 或版本发布混入普通同步。

## 流程

1. **检查仓库状态**
   - 查看当前分支、upstream、`git status --short --branch` 和本地/远端提交差异。
   - 阅读 staged、unstaged 和 untracked 变更清单；确认用户希望同步的具体改动。
   - 不清理、覆盖、重置或自动纳入无关文件。不要提交整个工作区来图省事。
   - 若无 upstream、处于 detached HEAD，或仓库状态不明，先停止并说明需要处理的条件。

2. **先 pull**
   - 使用 `git fetch` 更新远端跟踪信息，再从当前分支 upstream 执行 `git pull --rebase`，保持提交历史线性。
   - 若工作区有改动且 pull 会拒绝执行，先确认这些改动都仍在本地并可恢复；将工作区（包括 untracked 文件）临时 stash，pull 成功后立即恢复，再继续。不要删除 stash。
   - 出现冲突时保留双方内容，检查冲突文件并解决后继续 rebase；无法确定正确结果时停止并请用户决策。禁止用 `reset --hard`、`checkout --` 或 force push 处理冲突。
   - pull 完成后再次查看 `git status` 和分支差异，确认本地改动仍存在且没有意外纳入远端变化。

3. **Submit：创建 commit**
   - 只 stage 本次明确要提交的文件或 hunk；避免 `git add .` 和 `git add -A`，除非用户明确要求提交全部变更且已逐项核对。
   - 检查 staged diff，确认没有密钥、凭据、构建产物或无关改动。
   - 按仓库要求运行与改动相称的最小验证。测试失败时先修复或报告，不要提交未验证的改动，除非用户明确要求照常提交。
   - 创建描述准确的 commit。不要擅自 amend、squash 或重写已有提交。
   - 若没有可提交的改动，不创建空提交；继续检查是否有本地提交需要 push。

4. **最后 push**
   - 只推送当前分支到其已配置的 upstream：`git push`。
   - 推送成功后检查 `git status --short --branch` 和 ahead/behind，确认同步完成。
   - 若 push 因远端新增提交被拒绝，重新执行 pull → 检查/解决冲突 → 验证，再 push；不要 force push。
   - 若认证、网络或权限错误阻断推送，保留本地 commit，报告错误原因和本地/远端状态，不要重复创建提交。

## 汇报

完成后简要说明 pull 结果、创建的 commit（如有）、push 结果，以及仍未提交的本地改动。若流程中止，说明停在哪一步及原因；不要把“fetch 成功”描述成已完成 pull/commit/push 同步。