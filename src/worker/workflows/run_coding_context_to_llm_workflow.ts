/* @machine
file: worker/workflows/run_coding_context_to_llm_workflow.js
role: capture coding-page context and dispatch worker workflows
contract: establish send-context routes and delegate Smart Return and Exercism behavior
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

async function runWorkflow(
    selectedText = "",
    operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId()
) {
    if (workflowPromise) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "send-context",
            operationId,
            "workflow.skipped",
            { reason: "already-running" }
        );
        console.warn("[workflow] Already running; ignoring duplicate trigger.");
        return workflowPromise;
    }

    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "send-context",
        operationId,
        "workflow.started"
    );
    workflowPromise = runWorkflowOnce(selectedText, operationId);

    try {
        await workflowPromise;
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "send-context",
            operationId,
            "workflow.completed"
        );
    } catch (error) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "send-context",
            operationId,
            "workflow.failed",
            { errorName: error instanceof Error ? error.name : "UnknownError" }
        );
        throw error;
    } finally {
        workflowPromise = null;
    }
}

async function runWorkflowOnce(selectedText = "", operationId: string) {
    const totalStart = performance.now();

    function mark(label: string, start: number) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "send-context",
            operationId,
            "step.completed",
            {
                reason: label,
                durationMs: Math.round(performance.now() - start)
            }
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
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "send-context",
        operationId,
        "source.selected",
        { tabId: currentTab.id, platform: platform.name }
    );

    start = performance.now();
    let prompt;
    let contextFields;
    if (typeof selectedText === "string" && selectedText.trim()) {
        prompt = selectedText;
    } else {
        const context = await platform.getContext(currentTab.id);
        contextFields = diagnoseContext(context).fields;
        prompt = buildPrompt(context);
    }
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "send-context",
        operationId,
        "context.captured",
        { platform: platform.name, hasPayload: !!prompt, contextFields }
    );
    mark(`${platform.name}.getSource`, start);

    start = performance.now();
    const llm = await findLlmTab(
        currentTab,
        await getSelectedLlmProvider()
    );
    const deepSeekTab = llm.tab;
    await SmartReturn.routes.save({
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
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "send-context",
        operationId,
        "route.saved",
        {
            platform: platform.name,
            provider: llm.provider.name,
            sourceTabId: currentTab.id,
            targetTabId: deepSeekTab.id
        }
    );
    mark(`find ${llm.provider.name}`, start);

    start = performance.now();
    await chrome.tabs.update(deepSeekTab.id, { active: true });
    mark("activate DeepSeek", start);

    start = performance.now();
    await waitForDeepSeekInput(deepSeekTab.id);
    mark("waitForDeepSeekInput", start);

    start = performance.now();
    await insertText(deepSeekTab.id, prompt);
    mark("insertText", start);

    start = performance.now();
    await keyTap(deepSeekTab.id, "Enter");
    mark("Enter", start);

    start = performance.now();
    await scrollUp(deepSeekTab.id, 50);
    mark("scroll", start);

    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "send-context",
        operationId,
        "workflow.steps-completed",
        { durationMs: Math.round(performance.now() - totalStart) }
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
    if (message?.type === "coding-site2llm-diagnostic") {
        (globalThis as any).CodingSite2LlmDiagnostics.write(
            message.event,
            sender.tab?.id
        );
        return false;
    }

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
        const operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId();

        (globalThis as any).CodingSite2LlmDiagnostics.log(
            command === "smart-return" ? "smart-return" : "send-context",
            operationId,
            "trigger.received",
            { tabId: tab?.id, reason: "keyboard-shortcut" }
        );

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
                await runWorkflow(message.selectedText, operationId);
            } else if (command === "smart-return" && tab) {
                await SmartReturn.run(tab, operationId);
            }
        })().catch(error => {
            console.error("[workflow] ERROR:", error);
        });
        return;
    }

    if (message?.type === "run-workflow") {
        // The popup owns the send button, so it needs the outcome back.
        const operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId();
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "send-context",
            operationId,
            "trigger.received",
            { reason: "popup" }
        );
        runWorkflow("", operationId)
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
        SmartReturn.recordCopy(sender.tab?.id, message.text).catch(error => {
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