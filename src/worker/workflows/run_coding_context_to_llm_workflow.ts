/* @machine
file: worker/workflows/run_coding_context_to_llm_workflow.js
role: orchestrate send-context capture and dispatch worker message workflows
owns: source route creation, LLM prompt delivery, shortcut lock and runtime message routing
does_not_own: route-store internals, Smart Return execution, Exercism page and workflow details
contract: load state and feature owners before registering runtime dispatch
*/

let workflowPromise: Promise<void> | null = null;
let keyboardShortcutHeld = false;
let keyboardShortcutHeldReleaseToken = "";
let keyboardShortcutReleaseTimer: ReturnType<typeof setTimeout> | null = null;
const SELECTED_LLM_PROVIDER_KEY = "selectedLlmProvider";
const KEYBOARD_SHORTCUT_LOCK_TIMEOUT_MS = 10000;

async function getSelectedLlmProvider() {
    const stored = await chrome.storage.local.get(SELECTED_LLM_PROVIDER_KEY);
    return LLM_PROVIDERS.find(provider =>
        provider.name === stored[SELECTED_LLM_PROVIDER_KEY]
    ) || LLM_PROVIDERS[0];
}

async function runWorkflow(selectedText = "") {
    if (workflowPromise) {
        console.warn("[workflow] Already running; ignoring duplicate trigger.");
        return workflowPromise;
    }

    workflowPromise = runWorkflowOnce(selectedText);

    try {
        return await workflowPromise;
    } finally {
        workflowPromise = null;
    }
}

async function runWorkflowOnce(selectedText = "") {
    const totalStart = performance.now();

    function mark(label: string, start: number) {
        console.log(
            `[profiler] ${label}:`,
            Math.round(performance.now() - start),
            "ms"
        );
    }

    let start = performance.now();
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });
    const currentTab = tabs[0];
    mark("tabs.query", start);

    if (!currentTab?.id) {
        throw new Error("Current tab not found.");
    }

    const platform = getPlatform(currentTab.url);
    console.log("[workflow] platform:", platform.name);

    start = performance.now();
    let prompt;
    if (typeof selectedText === "string" && selectedText.trim()) {
        prompt = selectedText;
    } else {
        const context = await platform.getContext(currentTab.id);
        console.log("[workflow] context diagnostics:", diagnoseContext(context));
        prompt = buildPrompt(context);
    }
    mark(`${platform.name}.getSource`, start);
    console.log("[workflow] prompt:", prompt.length, "characters");

    start = performance.now();
    const llm = await findLlmTab(
        currentTab,
        await getSelectedLlmProvider()
    );
    const deepSeekTab = llm.tab;
    await saveReturnRoute({
        windowId: currentTab.windowId,
        sourceTabId: currentTab.id,
        llmTabId: deepSeekTab.id,
        sourcePlatform: platform.name,
        sourceUrl: currentTab.url || "",
        sourceIdentity: getCodingPageIdentity(
            currentTab.url || "",
            platform.name
        ),
        status: "routed",
        copied: false,
        copiedText: ""
    });
    mark(`find ${llm.provider.name}`, start);

    start = performance.now();
    await chrome.tabs.update(deepSeekTab.id, { active: true });
    mark("activate DeepSeek", start);

    start = performance.now();
    await waitForDeepSeekInput(deepSeekTab.id);
    mark("waitForDeepSeekInput", start);

    start = performance.now();
    await insertText(deepSeekTab.id, prompt);
    mark(`insertText (${prompt.length} chars)`, start);

    start = performance.now();
    await keyTap(deepSeekTab.id, "Enter");
    mark("Enter", start);

    start = performance.now();
    await scrollUp(deepSeekTab.id, 50);
    mark("scroll", start);

    console.log(
        "[profiler] TOTAL:",
        Math.round(performance.now() - totalStart),
        "ms"
    );
}

// Dormant while manifest.json sets action.default_popup (a popup swallows the
// icon click). Kept so removing the popup restores click-to-send unchanged.
chrome.action.onClicked.addListener(async () => {
    try {
        await runWorkflow();
    } catch (error) {
        console.error("[workflow] ERROR:", error);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "keyboard-shortcut-release") {
        if (message.releaseToken !== keyboardShortcutHeldReleaseToken) {
            return;
        }
        keyboardShortcutHeld = false;
        keyboardShortcutHeldReleaseToken = "";
        if (keyboardShortcutReleaseTimer) {
            clearTimeout(keyboardShortcutReleaseTimer);
            keyboardShortcutReleaseTimer = null;
        }
        return;
    }

    if (message?.type === "keyboard-shortcut") {
        const tab = sender.tab;
        const command = message.command;

        if (keyboardShortcutHeld) {
            return;
        }
        keyboardShortcutHeld = true;
        keyboardShortcutHeldReleaseToken = message.releaseToken || "";
        keyboardShortcutReleaseTimer = setTimeout(() => {
            keyboardShortcutHeld = false;
            keyboardShortcutHeldReleaseToken = "";
            keyboardShortcutReleaseTimer = null;
        }, KEYBOARD_SHORTCUT_LOCK_TIMEOUT_MS);

        (async () => {
            if (command === "send-context") {
                await runWorkflow(message.selectedText);
            } else if (command === "smart-return" && tab) {
                await runSmartReturn(tab);
            }
        })().catch(error => {
            console.error("[workflow] ERROR:", error);
        });
        return;
    }

    if (message?.type === "run-workflow") {
        // The popup owns the send button, so it needs the outcome back.
        runWorkflow()
            .then(() => sendResponse({ ok: true }))
            .catch(error => {
                console.error("[workflow] ERROR:", error);
                sendResponse({
                    ok: false,
                    error: String(error?.message || error)
                });
            });

        return true;
    }

    if (message?.type === "llm-copy") {
        recordLlmCopy(sender.tab?.id, message.text).catch(error => {
            console.error("[llm] copy tracking ERROR:", error);
        });
        return;
    }

    const exercismMessageResult = handleExercismWorkflowMessage(
        message,
        sender,
        sendResponse
    );
    if (exercismMessageResult !== null) {
        return exercismMessageResult;
    }
});