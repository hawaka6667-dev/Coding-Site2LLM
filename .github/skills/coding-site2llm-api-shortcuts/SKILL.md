---
name: coding-site2llm-api-shortcuts
description: 'Use when invoking, changing, or documenting Coding Site2LLM extension workflows, internal runtime messages, or configurable keyboard and mouse shortcuts. Covers send-context, Smart Return, popup actions, and shortcut settings.'
---

# Coding Site2LLM API And Shortcuts

Use this skill for this repository only. First consult `helper.md` for module ownership and workflow contracts; confirm current behavior in source and tests before changing it.

## Fast Tool Use 优化

优化掉多余ceremony

Optimize elapsed time: define the scenario once, avoid per-step commentary and exploratory reads, batch setup/actions/assertions, and return a compact summary. Do not time a human baseline for a deterministic test; use bounded waits.

Avoid redundant proof: do not repeat a successful real-input smoke for the same build/session unless the shortcut bridge changed or the prior evidence is missing. Test each requested behavioral branch once rather than adding cycles for a fixed round count. Batch state reads: after a necessary real keypress, assert the active Chrome tab and matching route together; include payload/editor/submit checks in that same evaluation when relevant. Combine final disposable-tab cleanup, route-integrity checks, and active-tab restoration where possible. Source-tab close and LLM-tab close are distinct lifecycle branches, but each needs only one disposable route setup.

Do not force every test into one fixed cycle matrix. Build the action sequence from the requested edge cases: any number of source and LLM tabs, switching among them, optional copy, returns, and closing/reopening disposable tabs. Preserve explicit tab IDs in the plan so each return and close assertion is checked against the correct route. Close only test-created tabs.

Use one real keyboard/copy smoke only when the shortcut or copy bridge itself is under test or has not already been verified for this build. For repeated lifecycle edges, batch the plan in one service-worker `evaluate_script`: invoke `run-workflow` from each source tab's isolated world; for a copy action, send `{ type: "llm-copy", text }` from the intended LLM tab's isolated world only after its route exists; invoke `keyboard-shortcut` with `command: "smart-return"` and its matching release from that LLM tab. Seed the clipboard with benign non-code text for no-copy fallback. This tests workflow/lifecycle contracts, not physical input; label the evidence accordingly. Never call extension runtime messages from a page's main world or use synthetic keyboard/copy events.

Use `run_playwright_code` only when its own page ID controls the same Chrome session with the extension loaded; `mcp_chrome_devtoo_list_pages` IDs are not Playwright IDs. Never guess IDs or open a parallel browser to substitute for the user's session. If no same-session batch runner is available, prefer the single service-worker batch above; do not fall back to N serial MCP key/evaluate calls.

## API Boundary 

Coding Site2LLM does not currently define a stable public API for arbitrary websites or external extensions. The `chrome.runtime` messages below are internal implementation contracts between this extension's content scripts, popup, and service worker. Do not present them as a supported external integration surface or call them from a page's main JavaScript world. For browser diagnosis, however, invoke the real internal command from the extension's isolated content-script world; this exercises the same runtime listener and workflow as the UI.

For user operation, prefer the Options page's configured shortcut or the extension popup. For code changes, keep message payloads and listeners within the existing workflow owners and verify the full message-to-action path in a real browser before treating unit tests as evidence that the chain works.

## User Actions

| Action | Meaning | Default bindings |
| --- | --- | --- |
| `send-context` | Capture the active coding page context and send it to the selected LLM. A non-empty page selection is sent as-is instead of extracting the full context. | `Alt+Q`, `Mouse5` |
| `smart-return` | Return from a supported LLM page to the source coding tab recorded by an explicit send, then run the existing return workflow. | `Alt+Q`, `Mouse5` |

The action is selected from the current page host: supported LLM hosts use `smart-return`; other injectable HTTP(S) pages use `send-context`. Shortcut names are action contracts; the key or mouse binding is user configuration, not the action identity.

Configure bindings in the extension Options page. The storage key is `codingSite2LlmShortcuts`; each action stores up to two string bindings. Legacy `run-workflow` values are read as a migration fallback. Keyboard bindings use a modifier plus one printable character; `Mouse4` and `Mouse5` are supported. Options changes are observed by the page-local shortcut bridge through `chrome.storage.onChanged`.

## Internal Message Contracts

- `keyboard-shortcut`: emitted by `src/worker/keyboard_shortcuts.js` with `command`, `releaseToken`, and optional `selectedText`; the service worker dispatches `send-context` or `smart-return`.
- `keyboard-shortcut-release`: emitted on key/mouse release so the service worker can release the duplicate-trigger lock. The timeout is only a fallback when release is lost.
- `run-workflow`: popup's Send action; the service worker runs the same send workflow and returns `{ ok, error? }` through `sendResponse`.
- `llm-copy`: copy tracking input recorded only for an existing Smart Return route; it is not a way to establish that route.

Do not add a second workflow path that bypasses the lock, source-route lifecycle, selected provider, or current message response behavior. Preserve the held-key/release pairing so a long press triggers only once.

## Where to Work

- Shortcut recognition, host-to-action choice, and release notifications: `src/worker/keyboard_shortcuts.js`.
- Runtime message dispatch and the send workflow: `src/worker/workflows/run_coding_context_to_llm_workflow.ts`.
- Shortcut capture, validation, persistence, and rendering: `src/options/options.js` and `src/options/options.html`.
- Popup Send button and its status handling: `src/popup/popup.js` and `src/popup/popup.html`.
- Injection and permissions: `src/manifest.json`.
- Smart Return routing and code transfer: `src/worker/workflows/smart_return/`.

Do not confuse browser-level `commands` API shortcuts with this extension's page-local shortcut bridge. The current bindings are read from extension local storage by content scripts injected on HTTP(S) pages; browser/extension internal pages are not supported injection targets.

## Change And Verify

1. Trace the selected user action from input to workflow. Keep UI, shortcut recognition, runtime dispatch, route lifecycle, and site-specific behavior in their existing owners.
2. If changing the message contract, update sender and listener together, preserve async `sendResponse` semantics where used, and add or update a focused contract test.
3. For shortcut diagnosis on an already-open page, refresh the affected page before testing so its content scripts are reinjected, especially if the extension was reloaded after the page opened. Refresh only the relevant tab; ask first if it may contain unsent work. Then use the real Chrome DevTools MCP `press_key` input for `Alt+Q` and an actual side-button input API for `Mouse5` when available. A runtime API call does not test the input bridge, and `defaultPrevented` alone does not prove the worker received the command; confirm the worker trigger and expected route/tab transition. Distinguish the MCP-selected page from Chrome's actually active tab; use `select_page(..., bringToFront: true)` and verify `chrome.tabs.query({ active: true })` when focus/return is part of the assertion.
4. For a real send-chain diagnosis, choose a harmless, non-LLM HTTP(S) page as the active tab. Warn that its extracted page context will be sent to the configured LLM provider. Through Chrome DevTools MCP, evaluate in the extension service worker and dispatch the same command used by the popup into that tab's isolated world:

   ```js
   async () => {
	   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	   if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
		   throw new Error("Select a normal HTTP(S) page first.");
	   }
	   const llmHosts = new Set([
		   "chat.deepseek.com", "chatgpt.com", "chat.openai.com",
		   "claude.ai", "gemini.google.com", "deepai.org"
	   ]);
	   if (llmHosts.has(new URL(tab.url).hostname)) {
		   throw new Error("The active tab must not be an LLM page.");
	   }
	   const [{ result }] = await chrome.scripting.executeScript({
		   target: { tabId: tab.id },
		   world: "ISOLATED",
		   func: () => chrome.runtime.sendMessage({ type: "run-workflow" })
	   });
	   return { sourceUrl: tab.url, response: result };
   }
   ```

	The popup listener returns `{ ok: true }` only after `runWorkflow` completes. Also read `codingSite2LlmReturnRoutes` from extension storage and report only the matching route's tab IDs, source URL/platform, status, and revision; never expose `copiedText`. Correlate `[CodingSite2LLM]` service-worker logs when Chrome MCP exposes them, but an empty console result alone is not evidence of failure. `{ ok: false, error }`, a missing response, or a missing expected route identifies a break in the send/route chain. Do not substitute a keypress, a unit test, or `chrome.runtime` from the page's main world for this command. `run-workflow` is an internal diagnostic surface, not a public website API.

	To probe the return side after a route exists, send `{ type: "keyboard-shortcut", command: "smart-return", releaseToken: "probe:smart-return" }` from the supported LLM tab's isolated world, then send the matching `keyboard-shortcut-release`. This dispatches the real Smart Return listener and requires the LLM tab as the message sender. Smart Return reads the system clipboard and may replace code. Any adapter-owned test/submit is a separate asynchronous side effect; it must not delay return completion, payload cleanup, or the next ret. Use a controlled clipboard payload and a disposable source page unless a real page test is explicitly requested.

	A Smart Return check should cover the requested behavior, not a prescribed number or order of cycles. For lifecycle stress, express the scenario as an ordered action plan that may reference multiple source/LLM tabs and include send, copy, return, switch, and close actions. Use one service-worker batch for repeated actions; use real `press_key` input when the shortcut bridge itself needs verification. Keep those evidence types distinct:

	```js
	const scenarioPlan = [
	    // Use only the actions/tabs needed for this request, e.g. send, copy,
	    // return, switch source, or close a disposable source/LLM tab.
	];
	// Execute the plan in one service-worker evaluation. Run page-originated
	// commands in the intended tab's ISOLATED world, await each transition, and
	// assert that each route belongs to the expected windowId + llmTabId.
	```

	For every action, assert only the relevant route, copied state, payload cleanup, editor, active-tab, or tab-removal result. With multiple pages, verify route isolation by `windowId + llmTabId`; after closing a disposable source or LLM tab, require its route and payload to be removed and ensure another page's route remains intact. Copy requires sample write-back; no-copy requires unchanged editor and no test or submit. Smart Return owns route validation, source activation, write-back, payload consumption, and its short return lock. Adapter-owned test/submit is outside that cycle: never await it or let it block payload cleanup or the next ret. For repeated Exercism failure/route-collision tests, use a distinct non-code payload each copy cycle; assert ret completion and payload consumption while the adapter test is still pending, then independently observe failure and verify the next ret remains usable. Do not craft a valid solution or aim for a passing submission for this test. Do not wait for model generation. Bound waits and stop on the first failed assertion.
5. Verify keyboard binding behavior separately with `node --test tests/worker/keyboard-shortcuts.test.js`. For message dispatch or popup/manifest changes, also run the closest relevant worker test and `npm run test:contracts`; use `npm run test:unit` when the affected workflow spans the worker suite. These scripts build the extension before running and are not proof of browser-chain behavior.
6. Follow the repository Chrome extension skill and `helper.md` for page refresh ownership and extension reload constraints; use Chrome DevTools MCP for real page behavior.
7. If a desired integration needs a public API, stop and define its trust boundary, permission model, supported callers, and compatibility contract before exposing an internal message.
