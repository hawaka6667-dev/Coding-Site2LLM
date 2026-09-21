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
    if (typeof platform.testAndSubmit === "function") {
        await platform.testAndSubmit(currentTab.id);
        return;
    }

    if (typeof platform.markComplete === "function") {
        await platform.markComplete(currentTab.id);
        return;
    }

    throw new Error("Exercism automation is not supported on this page.");
}

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

chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "exercism-test-submit") {
        return;
    }

    runExercismTestSubmit().catch(error => {
        console.error("[exercism] test and submit ERROR:", error);
    });
});