/* @machine
file: worker/workflows/exercism_workflow.js
role: coordinate Exercism test-submit and submitted-overview window creation
contract: preserve per-tab submission deduplication and validate submitted overview URLs
*/

const exercismSubmitPromises = new Map<number, Promise<void>>();

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

async function createSubmittedOverviewWindow(
    senderTab: chrome.tabs.Tab,
    overviewUrl: string,
    editorUrlValue = senderTab.url || ""
) {
    if (!senderTab?.id || typeof senderTab.url !== "string") {
        return false;
    }

    try {
        const senderUrl = new URL(senderTab.url);
        const editorUrl = new URL(editorUrlValue, senderTab.url);
        const targetUrl = new URL(overviewUrl, senderTab.url);
        const editorPathMatch = editorUrl.pathname.match(
            /^\/tracks\/[^/]+\/exercises\/[^/]+\/edit\/?$/
        );
        const editorPath = editorUrl.pathname.replace(/\/$/, "");
        const overviewPath = editorPath.replace(/\/edit$/, "");
        const senderPath = senderUrl.pathname.replace(/\/$/, "");

        if (
            senderUrl.origin !== "https://exercism.org" ||
            editorUrl.origin !== senderUrl.origin ||
            targetUrl.origin !== senderUrl.origin ||
            !editorPathMatch ||
            targetUrl.pathname !== overviewPath ||
            ![editorPath, overviewPath].includes(senderPath)
        ) {
            return false;
        }

        const createdWindow = await chrome.windows.create({
            url: "about:blank",
            focused: false            //出bug时要弄成显式追踪
        });

        if (!Number.isInteger(createdWindow?.id)) {
            return false;
        }

        try {
            const [createdTab] = await chrome.tabs.query({
                windowId: createdWindow.id
            });
            if (!Number.isInteger(createdTab?.id)) {
                throw new Error("Submitted overview tab was not created.");
            }
            await chrome.tabs.update(createdTab.id, { url: targetUrl.href });
        } catch (_) {
            await chrome.windows.remove(createdWindow.id).catch(() => {});
            return false;
        }

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
        createSubmittedOverviewWindow(
            sender.tab,
            message.overviewUrl,
            message.editorUrl
        )
            .then(opened => sendResponse({ opened }))
            .catch(error => {
                console.error("[exercism] overview window create ERROR:", error);
                sendResponse({ opened: false });
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
        .then(completed => sendResponse({ completed }))
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