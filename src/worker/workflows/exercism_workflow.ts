/* @machine
file: worker/workflows/exercism_workflow.js
role: coordinate Exercism test-submit and submitted-overview window lifecycle
contract: preserve per-tab submission deduplication and validate owned overview windows
*/

const exercismSubmitPromises = new Map<number, Promise<void>>();
const SUBMITTED_OVERVIEW_WINDOWS_KEY = "codingSite2LlmSubmittedOverviewWindows";
let submittedOverviewWindows: Record<string, string> | null = null;

async function runExercismTestSubmit(
    tabId?: number,
    options: { skipRun?: boolean } = {},
    operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId()
) {
    const currentTab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({
            active: true,
            currentWindow: true
        }))[0];

    if (!currentTab?.id) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-test-submit",
            operationId,
            "workflow.failed",
            { reason: "tab-not-found" }
        );
        throw new Error("Current tab not found.");
    }

    if (exercismSubmitPromises.has(currentTab.id)) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-test-submit",
            operationId,
            "workflow.skipped",
            { reason: "already-running", tabId: currentTab.id }
        );
        return exercismSubmitPromises.get(currentTab.id);
    }

    const startedAt = performance.now();
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "exercism-test-submit",
        operationId,
        "workflow.started",
        { tabId: currentTab.id, skipRun: options.skipRun === true }
    );
    const promise = (async () => {
        const platform = getPlatform(currentTab.url);
        if (typeof platform.testAndSubmit !== "function") {
            throw new Error("Exercism test and submit is not supported on this page.");
        }

        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-test-submit",
            operationId,
            "platform.selected",
            { tabId: currentTab.id, platform: platform.name }
        );
        await platform.testAndSubmit(currentTab.id, options);
    })();

    exercismSubmitPromises.set(currentTab.id, promise);

    try {
        await promise;
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-test-submit",
            operationId,
            "workflow.completed",
            {
                tabId: currentTab.id,
                durationMs: Math.round(performance.now() - startedAt)
            }
        );
    } catch (error) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-test-submit",
            operationId,
            "workflow.failed",
            {
                tabId: currentTab.id,
                errorName: error instanceof Error ? error.name : "UnknownError"
            }
        );
        throw error;
    } finally {
        if (exercismSubmitPromises.get(currentTab.id) === promise) {
            exercismSubmitPromises.delete(currentTab.id);
        }
    }
}

async function loadSubmittedOverviewWindows() {
    if (submittedOverviewWindows) {
        return submittedOverviewWindows;
    }

    const stored = await chrome.storage.session?.get?.(
        SUBMITTED_OVERVIEW_WINDOWS_KEY
    );
    const saved = stored?.[SUBMITTED_OVERVIEW_WINDOWS_KEY];
    submittedOverviewWindows = saved && typeof saved === "object"
        ? saved as Record<string, string>
        : {};
    return submittedOverviewWindows;
}

async function persistSubmittedOverviewWindows(windows: Record<string, string>) {
    submittedOverviewWindows = windows;
    await chrome.storage.session?.set?.({
        [SUBMITTED_OVERVIEW_WINDOWS_KEY]: windows
    });
}

async function createSubmittedOverviewWindow(
    senderTab: chrome.tabs.Tab,
    overviewUrl: string
) {
    if (!senderTab?.id || typeof senderTab.url !== "string") {
        return false;
    }

    try {
        const editorUrl = new URL(senderTab.url);
        const targetUrl = new URL(overviewUrl, senderTab.url);
        const exercisePath = editorUrl.pathname.match(
            /^\/tracks\/[^/]+\/exercises\/[^/]+\/edit\/?$/
        );

        if (
            editorUrl.origin !== "https://exercism.org" ||
            targetUrl.origin !== editorUrl.origin ||
            !exercisePath ||
            targetUrl.pathname !== exercisePath[0].replace(/\/edit\/?$/, "")
        ) {
            return false;
        }

        const createdWindow = await chrome.windows.create({
            url: targetUrl.href,
            focused: false
        });

        if (!Number.isInteger(createdWindow?.id)) {
            return false;
        }

        const windows = await loadSubmittedOverviewWindows();
        windows[String(createdWindow.id)] = targetUrl.pathname;
        try {
            await persistSubmittedOverviewWindows(windows);
        } catch (_) {
            await chrome.windows.remove(createdWindow.id).catch(() => {});
            return false;
        }

        return true;
    } catch (_) {
        return false;
    }
}

async function closeSubmittedOverviewWindow(senderTab: chrome.tabs.Tab) {
    if (!Number.isInteger(senderTab?.id) || !Number.isInteger(senderTab.windowId)) {
        return false;
    }

    try {
        const windows = await loadSubmittedOverviewWindows();
        const windowKey = String(senderTab.windowId);
        const expectedPath = windows[windowKey];
        const overviewUrl = new URL(senderTab.url || "");

        if (
            !expectedPath ||
            overviewUrl.origin !== "https://exercism.org" ||
            overviewUrl.pathname !== expectedPath
        ) {
            return false;
        }

        const tabs = await chrome.tabs.query({ windowId: senderTab.windowId });
        if (tabs.length === 1 && tabs[0].id === senderTab.id) {
            await chrome.windows.remove(senderTab.windowId);
        } else {
            await chrome.tabs.remove(senderTab.id);
        }

        delete windows[windowKey];
        await persistSubmittedOverviewWindows(windows);
        return true;
    } catch (_) {
        return false;
    }
}

function getExercismConceptsPath(exerciseUrl: string) {
    try {
        const parsedUrl = new URL(exerciseUrl);
        const match = parsedUrl.pathname.match(
            /^\/tracks\/([^/]+)\/exercises\/[^/]+(?:\/edit)?\/?$/
        );

        return parsedUrl.origin === "https://exercism.org" && match
            ? `/tracks/${match[1]}/concepts`
            : "";
    } catch (_) {
        return "";
    }
}

async function reloadExercismConceptsForExercise(exerciseUrl: string) {
    const conceptsPath = getExercismConceptsPath(exerciseUrl);
    if (!conceptsPath) {
        return false;
    }

    const tabs = await chrome.tabs.query({
        url: "https://exercism.org/tracks/*/concepts*"
    });
    const matchingTabs = tabs.filter(tab => {
        try {
            const parsedUrl = new URL(tab.url);
            return parsedUrl.origin === "https://exercism.org" &&
                (parsedUrl.pathname === conceptsPath ||
                    parsedUrl.pathname === `${conceptsPath}/`);
        } catch (_) {
            return false;
        }
    });

    await Promise.all(matchingTabs
        .filter(tab => Number.isInteger(tab.id))
        .map(tab => chrome.tabs.reload(tab.id)));
    return matchingTabs.length > 0;
}

async function markCompleteAndRefreshConcepts(
    tabId: number,
    exerciseUrl: string,
    operationId: string
) {
    const platform = getPlatform(exerciseUrl);
    if (typeof platform.markComplete !== "function") {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-mark-complete",
            operationId,
            "workflow.skipped",
            { reason: "unsupported-platform", tabId }
        );
        return false;
    }

    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "exercism-mark-complete",
        operationId,
        "completion.started",
        { platform: platform.name, tabId }
    );
    const completed = await platform.markComplete(tabId);
    if (completed !== true) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-mark-complete",
            operationId,
            "completion.not-confirmed",
            { reason: "page-did-not-confirm", tabId }
        );
        return false;
    }

    const settings = await chrome.storage.local.get(
        "exercismRefreshConceptsAfterComplete"
    );
    if (settings.exercismRefreshConceptsAfterComplete === false) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "exercism-mark-complete",
            operationId,
            "completion.confirmed",
            { platform: platform.name, tabId }
        );
        return true;
    }

    const refreshed = await reloadExercismConceptsForExercise(exerciseUrl);
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "exercism-mark-complete",
        operationId,
        "completion.confirmed",
        { platform: platform.name, tabId, result: refreshed ? "concepts-refreshed" : "no-concepts-tab" }
    );
    return true;
}

function handleExercismWorkflowMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
): boolean | null {
    if (message?.type === "exercism-test-submit") {
        const diagnostics = (globalThis as any).CodingSite2LlmDiagnostics;
        const operationId = message.operationId || diagnostics.createOperationId();
        diagnostics.log("exercism-test-submit", operationId, "trigger.received", {
            tabId: sender.tab?.id
        });
        runExercismTestSubmit(sender.tab?.id, {}, operationId).catch(error => {
            console.error(`[Exercism][${operationId}] test and submit ERROR:`, error);
        });
        return false;
    }

    if (message?.type === "exercism-run-tests-clicked") {
        const tabId = sender.tab?.id;
        const diagnostics = (globalThis as any).CodingSite2LlmDiagnostics;
        const operationId = message.operationId || diagnostics.createOperationId();
        diagnostics.log("exercism-test-submit", operationId, "trigger.received", {
            tabId,
            reason: "manual-test-run"
        });

        if (tabId) {
            runExercismTestSubmit(tabId, { skipRun: true }, operationId).catch(error => {
                console.error(`[Exercism][${operationId}] manual test and submit ERROR:`, error);
            });
        }

        return false;
    }

    if (message?.type === "exercism-create-submitted-overview-window") {
        createSubmittedOverviewWindow(sender.tab, message.overviewUrl)
            .then(opened => sendResponse({ opened }))
            .catch(error => {
                console.error("[exercism] overview window create ERROR:", error);
                sendResponse({ opened: false });
            });
        return true;
    }

    if (message?.type === "exercism-close-submitted-overview-window") {
        closeSubmittedOverviewWindow(sender.tab)
            .then(closed => sendResponse({ closed }))
            .catch(error => {
                console.error("[exercism] overview window close ERROR:", error);
                sendResponse({ closed: false });
            });
        return true;
    }

    if (message?.type !== "exercism-mark-complete") {
        return null;
    }

    const diagnostics = (globalThis as any).CodingSite2LlmDiagnostics;
    const operationId = message.operationId || diagnostics.createOperationId();
    diagnostics.log("exercism-mark-complete", operationId, "trigger.received", {
        tabId: sender.tab?.id
    });
    const tabId = sender.tab?.id;
    if (!tabId) {
        diagnostics.log("exercism-mark-complete", operationId, "workflow.failed", {
            reason: "sender-tab-not-found"
        });
        sendResponse({ completed: false });
        return false;
    }

    markCompleteAndRefreshConcepts(tabId, sender.tab.url, operationId)
        .then(completed => {
            sendResponse({ completed });
            if (completed && typeof chrome.tabs.sendMessage === "function") {
                chrome.tabs.sendMessage(tabId, {
                    type: "exercism-submitted-overview-completion-result",
                    completed: true,
                    operationId
                }).catch(error => {
                    console.error(`[Exercism][${operationId}] completion notice ERROR:`, error);
                });
            }
        })
        .catch(error => {
            diagnostics.log("exercism-mark-complete", operationId, "workflow.failed", {
                tabId,
                errorName: error instanceof Error ? error.name : "UnknownError"
            });
            console.error(`[Exercism][${operationId}] mark complete ERROR:`, error);
            sendResponse({ completed: false });
        });
    return true;
}