/*
 * Responsibility: coordinate the end-to-end workflow and Chrome listeners.
 * Do not put website selectors or page-specific extraction here.
 */

let workflowPromise = null;

async function runWorkflow() {
    if (workflowPromise) {
        console.warn("[workflow] Already running; ignoring duplicate trigger.");
        return workflowPromise;
    }

    workflowPromise = runWorkflowOnce();

    try {
        return await workflowPromise;
    } finally {
        workflowPromise = null;
    }
}

async function runWorkflowOnce() {
    const totalStart = performance.now();

    function mark(label, start) {
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
    const context = await platform.getContext(currentTab.id);
    console.log("[workflow] context diagnostics:", diagnoseContext(context));
    const prompt = buildPrompt(context);
    mark(`${platform.name}.getSource`, start);
    console.log("[workflow] prompt:", prompt.length, "characters");

    start = performance.now();
    const llm = await findLlmTab(currentTab);
    const deepSeekTab = llm.tab;
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

async function runExercismTestSubmit() {
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });
    const currentTab = tabs[0];

    if (!currentTab?.id) {
        throw new Error("Current tab not found.");
    }

    const platform = getPlatform(currentTab.url);
    if (typeof platform.testAndSubmit !== "function") {
        throw new Error("Exercism test and submit is not supported on this page.");
    }

    await platform.testAndSubmit(currentTab.id);
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

chrome.commands.onCommand.addListener(async command => {
    try {
        if (command === "run-workflow") {
            await runWorkflow();
        }
    } catch (error) {
        console.error("[workflow] ERROR:", error);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    if (message?.type === "exercism-test-submit") {
        runExercismTestSubmit().catch(error => {
            console.error("[exercism] test and submit ERROR:", error);
        });
        return;
    }

    if (message?.type !== "exercism-mark-complete") {
        return;
    }

    const tabId = sender.tab?.id;
    if (!tabId) {
        console.error("[exercism] mark complete ERROR: sender tab not found.");
        return;
    }

    const platform = getPlatform(sender.tab.url);
    if (typeof platform.markComplete !== "function") {
        console.error("[exercism] mark complete ERROR: unsupported page.");
        return;
    }

    platform.markComplete(tabId).catch(error => {
        console.error("[exercism] mark complete ERROR:", error);
    });
});