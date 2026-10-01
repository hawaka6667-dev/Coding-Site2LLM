---
name: version-management
description: '通用版本管理工作流。用户要求升版本、bump version、选择版本号、校验版本/tag，或准备发版/release 时使用；适配当前仓库已有的版本策略、版本源和工具链。'
---

# Version Management

Apply this workflow to the repository in the current workspace. Discover its conventions instead of assuming a language, package manager, manifest path, version format, or release process.

## When to Use


## Repository Version Commands

This repository manages the extension version in `src/manifest.json` with `.build/version.ps1`:

```powershell
npm run version -- -Action Get
npm run version -- -Action Bump -Level Change
npm run version -- -Action Validate
```

`Bump` defaults to `Change`; supported levels are `Change`, `Batch`, `Minor`, and `Major`, following the increments documented in `helper.md`. `Validate` checks the four-part format and that the matching `v<version>` Git tag is unused. The script changes only the manifest version; it does not commit, tag, push, or publish.

## Workflow

1. Identify the target package or deployable component. In a monorepo, do not bump unrelated packages; ask if the target is ambiguous.
2. Inspect nearby project guidance, manifests, build/release scripts, version tests, and relevant Git tags. Use the current repository's instructions as the source of truth.
3. Find the canonical editable version source and any synchronized version declarations. Distinguish source files from generated artifacts; do not edit generated output directly unless the project explicitly requires it.
4. Determine the established version scheme (for example SemVer, CalVer, or a custom format) and release channel. Apply constraints in this order: hard requirements from the target ecosystem/tooling, repository policy, then general versioning guidance. Preserve the required format; do not impose SemVer or a new policy when the repository already defines one. If an ecosystem requires three numeric components (for example, Obsidian's `MAJOR.MINOR.PATCH` format), never add a fourth component such as `0.0.0.0` for internal bookkeeping.
5. Decide whether this delivery needs a bump according to repository policy and user intent. Do not assume that documentation-only, test-only, or internal changes always require a new version.
6. Choose the smallest increment that truthfully represents the change. Refer to [version examples](./version-examples.md) only as general guidance; repository-specific policy takes precedence.
7. Keep one current version in the source tree and generated distribution directory: update the canonical source and only related declarations or changelog entries required by the project. Do not keep parallel version snapshots or historical source copies in the repository, and remove stale versioned build directories after a successful build. Let Git tags and GitHub Releases retain and manage published versions; generated release assets may be produced temporarily as required by the release workflow. Avoid introducing duplicate version sources.
8. Run the repository's version check, then the smallest relevant tests/build. Verify format constraints, synchronized values, and that the proposed release identifier is not already assigned to a tag or release. Compare tags using the project's version semantics, not lexical ordering alone.
9. Keep versioning separate from publishing. Do not commit, create/push tags, or publish a release unless explicitly requested. When publishing is requested, follow the repository's release workflow.

Preserve unrelated working-tree changes. Do not stage or include them as part of version management. Report the selected component, old and new versions, files changed, validation performed, and any assumptions or release steps not performed.