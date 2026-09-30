# Architecture
//This document lists the project directory structure and file names only.

```text
Coding-Site2LLM/
├── .build/
│   ├── build-extension.js
│   ├── package.ps1
│   └── release.ps1
├── .github/
│   └── skills/
│       ├── chrome-extension-dev/
│       │   └── SKILL.md
│       ├── git-sync-publish/
│       │   └── SKILL.md
│       ├── helper-update/
│       │   └── SKILL.md
│       └── normal-contracts/
│           └── SKILL.md
├── algo run/
├── dist/
├── src/
│   ├── background.ts
│   ├── icons/
│   │   ├── icon-preview.html
│   │   ├── icon-theme-ice-cyan-128.png
│   │   ├── icon-theme-ice-cyan-16.png
│   │   ├── icon-theme-ice-cyan-32.png
│   │   ├── icon-theme-ice-cyan-48.png
│   │   ├── icon-theme-ice-cyan-64.png
│   │   ├── icon-theme-lemon-128.png
│   │   ├── icon-theme-lemon-16.png
│   │   ├── icon-theme-lemon-32.png
│   │   ├── icon-theme-lemon-48.png
│   │   ├── icon-theme-lemon-64.png
│   │   ├── icon-theme-mint-128.png
│   │   ├── icon-theme-mint-16.png
│   │   ├── icon-theme-mint-32.png
│   │   ├── icon-theme-mint-48.png
│   │   ├── icon-theme-mint-64.png
│   │   ├── icon-theme-warm-ivory-128.png
│   │   ├── icon-theme-warm-ivory-16.png
│   │   ├── icon-theme-warm-ivory-32.png
│   │   ├── icon-theme-warm-ivory-48.png
│   │   ├── icon-theme-warm-ivory-64.png
│   │   ├── icon128.png
│   │   ├── icon16.png
│   │   ├── icon32.png
│   │   └── icon48.png
│   ├── manifest.json
│   ├── options/
│   │   ├── options.html
│   │   └── options.js
│   ├── popup/
│   │   ├── daily_practice_providers.js
│   │   ├── popup.html
│   │   └── popup.js
│   └── worker/
│       ├── adapters/
│       │   ├── codewars_adapter.ts
│       │   ├── exercism_edit_adapter.ts
│       │   ├── exercism_overview_adapter.ts
│       │   ├── leetcode_adapter.ts
│       │   └── source_fallback_adapter.ts
│       ├── exercism/
│       │   ├── preserve_track_list_scroll_position.js
│       │   ├── edit/
│       │   │   ├── auto_submit_after_manual_run.js
│       │   │   ├── content.js
│       │   │   ├── continue_after_exercism_modals.js
│       │   │   └── manage_submitted_exercism_overview_window.js
│       │   └── overview/
│       │       ├── auto_mark_exercise_complete.js
│       │       ├── dismiss_exercism_overview_closable_dialogs.js
│       │       └── open_exercise_in_editor.js
│       ├── configure_supported_coding_sites_and_llm_providers.ts
│       ├── find_llm_tab_and_insert_prompt.ts
│       ├── inject_scripts_and_control_coding_page.ts
│       ├── keyboard_shortcuts.js
│       ├── llm_copy_tracker.js
│       ├── manage_icon_theme.ts
│       ├── route_coding_page_and_build_llm_prompt.ts
│       ├── run_coding_context_to_llm_workflow.ts
│       └── runtime_types.d.ts
├── tests/
│   ├── dev-check.ps1
│   ├── exercism/
│   │   ├── edit/
│   │   │   ├── continue-dialogs.test.js
│   │   │   ├── manual-run-submit.test.js
│   │   │   ├── submit-redirect.test.js
│   │   │   └── test-and-submit-worker.test.js
│   │   ├── overview/
│   │   │   ├── auto-mark-complete.test.js
│   │   │   ├── dismiss-closable-dialogs.test.js
│   │   │   └── open-exercise-in-editor.test.js
│   │   ├── submission-workflow.test.js
│   │   └── track-list-scroll.test.js
│   ├── global-extension-contract.test.js
│   ├── worker-test-harness.js
│   ├── popup-daily-practice.test.js
│   ├── routing/
│   │   ├── coding-tab-selection.test.js
│   │   ├── editor-targeting.test.js
│   │   ├── llm-provider-selection.test.js
│   │   └── site-adapters.test.js
│   ├── session-end.ps1
│   ├── version-contract.test.js
│   └── worker/
│       ├── context-extraction.test.js
│       ├── keyboard-shortcuts.test.js
│       ├── return-routing.test.js
│       └── smart-return-workflow.test.js
├── .gitattributes
├── .gitignore
├── ARCHITECTURE.md
├── Design Doc.md
├── helper.md
├── package-lock.json
├── package.json
├── README.md
└── tsconfig.extension.json
```
