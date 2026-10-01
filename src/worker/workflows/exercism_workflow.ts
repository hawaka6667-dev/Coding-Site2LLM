/* @machine
file: worker/workflows/exercism_workflow.js
role: coordinate Exercism submission and submitted-overview lifecycle
owns: per-tab submit deduplication, owned overview windows, Mark Complete and concepts refresh
does_not_own: page selectors, editor DOM automation, send-context and Smart Return
contract: validate sender and exercise path before creating or closing owned overview windows
*/

const exercismSubmitPromises = new Map<number, Promise<void>>();
const SUBMITTED_OVERVIEW_WINDOWS_KEY = "codingSite2LlmSubmittedOverviewWindows";
let submittedOverviewWindows: Record<string, string> | null = null;

async function runExercismTestSubmit(
    tabId?: number,
    options: { skipRun?: boolean } = {}
) {
    const currentTab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({
            active: true,
            currentWindow: true
        }))[0];

    if (!currentTab?.id) {
        throw new Error("Current tab not found.");
    }

    if (exercismSubmitPromises.has(currentTab.id)) {
        return exercismSubmitPromises.get(currentTab.id);
    }

    const promise = (async () => {
        const platform = getPlatform(currentTab.url);
        if (typeof platform.testAndSubmit !== "function") {
            throw new Error("Exercism test and submit is not supported on this page.");
        }

        await platform.testAndSubmit(currentTab.id, options);
    })();

    exercismSubmitPromises.set(currentTab.id, promise);

    try {
        await promise;
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

async function markCompleteAndRefreshConcepts(tabId: number, exerciseUrl: string) {
    const platform = getPlatform(exerciseUrl);
    if (typeof platform.markComplete !== "function") {
        return false;
    }

    const completed = await platform.markComplete(tabId);
    if (completed !== true) {
        return false;
    }

    const settings = await chrome.storage.local.get(
        "exercismRefreshConceptsAfterComplete"
    );
    if (settings.exercismRefreshConceptsAfterComplete === false) {
        return true;
    }

    await reloadExercismConceptsForExercise(exerciseUrl);
    return true;
}

function handleExercismWorkflowMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
): boolean | null {
    if (message?.type === "exercism-test-submit") {
        runExercismTestSubmit(sender.tab?.id).catch(error => {
            console.error("[exercism] test and submit ERROR:", error);
        });
        return false;
    }

    if (message?.type === "exercism-run-tests-clicked") {
        const tabId = sender.tab?.id;

        if (tabId) {
            runExercismTestSubmit(tabId, { skipRun: true }).catch(error => {
                console.error("[exercism] manual test and submit ERROR:", error);
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

    const tabId = sender.tab?.id;
    if (!tabId) {
        console.error("[exercism] mark complete ERROR: sender tab not found.");
        sendResponse({ completed: false });
        return false;
    }

    markCompleteAndRefreshConcepts(tabId, sender.tab.url)
        .then(completed => {
            sendResponse({ completed });
            if (completed && typeof chrome.tabs.sendMessage === "function") {
                chrome.tabs.sendMessage(tabId, {
                    type: "exercism-submitted-overview-completion-result",
                    completed: true
                }).catch(error => {
                    console.error("[exercism] overview completion notice ERROR:", error);
                });
            }
        })
        .catch(error => {
            console.error("[exercism] mark complete ERROR:", error);
            sendResponse({ completed: false });
        });
    return true;
}