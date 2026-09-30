/* @machine
file: worker/run_coding_context_to_llm_workflow.js
role: coordinate end-to-end workflow and Chrome listeners
contract: no website selectors or page-specific extraction
可能需要解耦
*/

let workflowPromise: Promise<void> | null = null;
let returnRoutes: Record<string, CodingSiteReturnRoute> | null = null;
const smartReturnPromises = new Map<string, Promise<void>>();
let keyboardShortcutHeld = false;
let keyboardShortcutHeldReleaseToken = "";
let keyboardShortcutReleaseTimer: ReturnType<typeof setTimeout> | null = null;
const exercismSubmitPromises = new Map();
const RETURN_ROUTE_KEY = "codingSite2LlmReturnRoute";
const RETURN_ROUTES_KEY = "codingSite2LlmReturnRoutes";
const SUBMITTED_OVERVIEW_WINDOWS_KEY = "codingSite2LlmSubmittedOverviewWindows";
const SELECTED_LLM_PROVIDER_KEY = "selectedLlmProvider";
const KEYBOARD_SHORTCUT_LOCK_TIMEOUT_MS = 10000;
let submittedOverviewWindows: Record<string, string> | null = null;

async function getSelectedLlmProvider() {
    const stored = await chrome.storage.local.get(SELECTED_LLM_PROVIDER_KEY);
    return LLM_PROVIDERS.find(provider =>
        provider.name === stored[SELECTED_LLM_PROVIDER_KEY]
    ) || LLM_PROVIDERS[0];
}

async function saveReturnRoute(route: CodingSiteReturnRoute) {
    const routes = await loadReturnRoutes();
    const key = getReturnRouteKey(route.windowId, route.llmTabId);
    routes[key] = route;
    await persistReturnRoutes(routes);
}

async function persistReturnRoutes(routes: Record<string, CodingSiteReturnRoute>) {
    returnRoutes = routes;
    const value = { [RETURN_ROUTES_KEY]: routes };
    await chrome.storage?.local?.set?.(value);
    await chrome.storage?.session?.set?.(value);
}

async function clearReturnRoute(routeKey: string) {
    const routes = await loadReturnRoutes();

    if (!Object.hasOwn(routes, routeKey)) {
        return false;
    }

    delete routes[routeKey];
    await persistReturnRoutes(routes);
    return true;
}

async function loadReturnRoute() {
    const routes = await loadReturnRoutes();
    const tabs = await chrome.tabs.query({});
    const activeLlmTab = tabs.find(tab => tab.active && isLlmUrl(tab.url));
    return activeLlmTab
        ? routes[getReturnRouteKey(activeLlmTab.windowId, activeLlmTab.id)] || null
        : null;
}

function getReturnRouteKey(windowId: number, llmTabId: number) {
    return `${windowId}:${llmTabId}`;
}

function normalizeReturnRoute(route: unknown): CodingSiteReturnRoute | null {
    if (!route || typeof route !== "object") {
        return null;
    }

    const savedRoute = route as Partial<CodingSiteReturnRoute>;

    if (savedRoute.windowId === undefined || savedRoute.llmTabId === undefined) {
        return null;
    }

    let sourcePlatform = savedRoute.sourcePlatform;

    if (!sourcePlatform && savedRoute.sourceUrl) {
        try {
            sourcePlatform = getPlatform(savedRoute.sourceUrl).name;
        } catch (_) {
            sourcePlatform = "";
        }
    }

    return {
        ...savedRoute,
        windowId: savedRoute.windowId,
        llmTabId: savedRoute.llmTabId,
        sourcePlatform: sourcePlatform || "",
        sourceIdentity: savedRoute.sourceIdentity || getCodingPageIdentity(
            savedRoute.sourceUrl,
            sourcePlatform || ""
        ),
        status: savedRoute.status || (savedRoute.sourceTabId ? "routed" : "orphaned")
    };
}

async function loadReturnRoutes() {
    if (returnRoutes) {
        return returnRoutes;
    }

    const stored = await chrome.storage?.local?.get?.([
        RETURN_ROUTES_KEY,
        RETURN_ROUTE_KEY
    ]);
    const sessionStored = await chrome.storage?.session?.get?.([
        RETURN_ROUTES_KEY,
        RETURN_ROUTE_KEY
    ]);
    const savedRoutes = stored?.[RETURN_ROUTES_KEY] ||
        sessionStored?.[RETURN_ROUTES_KEY];

    if (savedRoutes && typeof savedRoutes === "object") {
        returnRoutes = Object.fromEntries(
            Object.entries(savedRoutes)
                .map(([key, route]) => [key, normalizeReturnRoute(route)])
                .filter(([, route]) => route)
        );
        return returnRoutes;
    }

    const legacyRoute = stored?.[RETURN_ROUTE_KEY] ||
        sessionStored?.[RETURN_ROUTE_KEY];
    const normalizedLegacyRoute = normalizeReturnRoute(legacyRoute);
    returnRoutes = normalizedLegacyRoute?.windowId !== undefined &&
        normalizedLegacyRoute?.llmTabId !== undefined
        ? { [getReturnRouteKey(normalizedLegacyRoute.windowId, normalizedLegacyRoute.llmTabId)]: normalizedLegacyRoute }
        : {};
    return returnRoutes;
}

function isLlmUrl(url: string | undefined) {
    return LLM_PROVIDERS.some(provider => provider.match(url || ""));
}

async function readClipboard(tabId: number) {
    return executePage(tabId, async () => {
        try {
            return (await navigator.clipboard.readText()).trim();
        } catch (_) {
            return "";
        }
    });
}

function isLikelyCode(text: string) {
    const value = String(text || "").trim();

    if (!value || value.length < 3 || value.length > 100000) {
        return false;
    }

    return /(?:[{};]|=>|\b(?:const|let|var|function|return|class|def|import|from|public|private|if|for|while)\b|<!--[\s\S]*-->|^\s*#include\b)/m.test(value);
}

async function recordLlmCopy(tabId: number, text: string) {
    const tabs = await chrome.tabs.query({});
    const llmTab = tabs.find(tab => tab.id === tabId && isLlmUrl(tab.url));
    const route = llmTab
        ? (await loadReturnRoutes())[getReturnRouteKey(llmTab.windowId, tabId)]
        : null;

    if (
        !route ||
        route.llmTabId !== tabId ||
        typeof text !== "string"
    ) {
        return;
    }

    await saveReturnRoute({
        ...route,
        copied: true,
        copiedText: text || ""
    });
}

async function replaceCode(tabId: number, text: string) {
    const sourceTab = await chrome.tabs.get?.(tabId);
    const platform = sourceTab?.url ? getPlatform(sourceTab.url) : null;

    if (typeof platform?.replaceCode === "function") {
        await platform.replaceCode(tabId, text);
        return;
    }

    const replaced = await executePage(tabId, value => {
        if (window.monaco?.editor) {
            const model = window.monaco.editor.getModels()[0];

            if (model) {
                model.setValue(value);
                return true;
            }
        }

        const input = document.querySelector(
            '.cm-editor .cm-content[contenteditable="true"], textarea, [contenteditable="true"]'
        );

        if (!input || input.offsetWidth === 0 || input.offsetHeight === 0) {
            return false;
        }

        input.focus();

        if (input.isContentEditable) {
            document.execCommand("selectAll", false);
            if (!document.execCommand("insertText", false, value)) {
                input.textContent = value;
            }
        } else {
            const prototype = Object.getPrototypeOf(input);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
            if (descriptor?.set) {
                descriptor.set.call(input, value);
            } else {
                input.value = value;
            }
        }

        input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value
        }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }, [text]);

    if (replaced !== true) {
        throw new Error("Could not replace code in the coding page editor.");
    }
}

async function submitCode(tabId: number) {
    await executePage(tabId, () => {
        const target = document.activeElement || document;

        for (const type of ["keydown", "keyup"]) {
            target.dispatchEvent(new KeyboardEvent(type, {
                key: "Enter",
                code: "Enter",
                ctrlKey: true,
                bubbles: true,
                cancelable: true
            }));
        }
    });
}

async function submitReturnedCode(tabId: number) {
    const sourceTab = await chrome.tabs.get?.(tabId);
    const platform = sourceTab?.url ? getPlatform(sourceTab.url) : null;

    if (typeof platform?.testAndSubmit === "function") {
        await platform.testAndSubmit(tabId);
        return;
    }

    await submitCode(tabId);
}

async function returnToCodingPage(llmTab: chrome.tabs.Tab) {
    const routes = await loadReturnRoutes();
    const routeKey = getReturnRouteKey(llmTab.windowId, llmTab.id);
    let route = routes[routeKey];

    if (
        !route ||
        route.windowId !== llmTab.windowId ||
        route.llmTabId !== llmTab.id
    ) {
        return;
    }

    const tabs = await chrome.tabs.query({ windowId: llmTab.windowId });
    const sourceTab = tabs.find(tab => tab.id === route.sourceTabId);

    const maintainedIdentity = route.sourceIdentity || getCodingPageIdentity(
        route.sourceUrl || "",
        route.sourcePlatform || ""
    );

    if (sourceTab?.url && maintainedIdentity) {
        const sourceIdentity = getCodingPageIdentity(
            sourceTab.url,
            route.sourcePlatform
        );

        if (!sourceIdentity || sourceIdentity !== maintainedIdentity) {
            await clearReturnRoute(routeKey);
            return;
        }
    }

    const sourceIsValid = sourceTab &&
        isCodingTabForPlatform(sourceTab, route.sourcePlatform, maintainedIdentity);
    const targetPlatform = route.sourcePlatform === "Exercism overview"
        ? "Exercism"
        : route.sourcePlatform;
    const targetTab = sourceIsValid
        ? sourceTab
        : findRightCodingTab(
            tabs,
            llmTab,
            targetPlatform,
            maintainedIdentity
        );

    if (!targetTab) {
        await saveReturnRoute({ ...route, sourceTabId: null, status: "orphaned" });
        return;
    }

    route = {
        ...route,
        sourceTabId: targetTab.id,
        status: "routed"
    };
    await saveReturnRoute(route);

    const clipboardText = await readClipboard(llmTab.id);
    const copiedText = route.copiedText || clipboardText;
    const paste = route.copied
        ? copiedText
        : isLikelyCode(clipboardText)
            ? clipboardText
            : "";

    await chrome.tabs.update(targetTab.id, { active: true });

    try {
        if (paste) {
            await replaceCode(targetTab.id, paste);
            await submitReturnedCode(targetTab.id);
        }
    } finally {
        await saveReturnRoute({
            ...route,
            copied: false,
            copiedText: ""
        });
    }
}

async function runSmartReturn(llmTab: chrome.tabs.Tab) {
    const routeKey = getReturnRouteKey(llmTab.windowId, llmTab.id);

    if (smartReturnPromises.has(routeKey)) {
        console.warn("[workflow] Smart Return already running; ignoring duplicate trigger.");
        return;
    }

    const promise = returnToCodingPage(llmTab);
    smartReturnPromises.set(routeKey, promise);

    try {
        await promise;
    } finally {
        if (smartReturnPromises.get(routeKey) === promise) {
            smartReturnPromises.delete(routeKey);
        }
    }
}

function isCodingTabForPlatform(
    tab: chrome.tabs.Tab,
    sourcePlatform: string,
    preferredIdentity = ""
) {
    if (
        !tab?.id ||
        !tab.url ||
        (sourcePlatform === "Web source" && !preferredIdentity)
    ) {
        return false;
    }

    try {
        if (
            sourcePlatform === "LeetCode" &&
            new URL(tab.url).pathname.includes("/submissions/")
        ) {
            return false;
        }

        const platform = getPlatform(tab.url);
        return platform.name === sourcePlatform &&
            platform.name !== "Exercism overview" &&
            (sourcePlatform !== "Web source" ||
                getCodingPageIdentity(tab.url, sourcePlatform) === preferredIdentity);
    } catch (_) {
        return false;
    }
}

function findRightCodingTab(
    tabs: chrome.tabs.Tab[],
    llmTab: chrome.tabs.Tab,
    sourcePlatform: string,
    preferredIdentity = ""
) {
    const candidates = tabs
        .filter(tab => typeof tab.index === "number" && tab.index > llmTab.index)
        .filter(tab => isCodingTabForPlatform(tab, sourcePlatform, preferredIdentity))
        .sort((left, right) => left.index - right.index);

    if (preferredIdentity) {
        return candidates.find(tab =>
            getCodingPageIdentity(tab.url, sourcePlatform) === preferredIdentity
        ) || null;
    }

    return candidates[0] || null;
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

// Dormant while manifest.json sets action.default_popup (a popup swallows the
// icon click). Kept so removing the popup restores click-to-send unchanged.
chrome.action.onClicked.addListener(async () => {
    try {
        await runWorkflow();
    } catch (error) {
        console.error("[workflow] ERROR:", error);
    }
});

function invalidateReturnRoutesForSourceUrlChange(tabId: number, url: string) {
    if (!Number.isInteger(tabId) || typeof url !== "string") {
        return;
    }

    loadReturnRoutes()
        .then(async routes => {
            let changed = false;

            for (const [key, route] of Object.entries(routes)) {
                if (route.sourceTabId !== tabId || route.sourceUrl === url) {
                    continue;
                }

                const previousIdentity = route.sourceIdentity ||
                    getCodingPageIdentity(route.sourceUrl, route.sourcePlatform);
                const identityPlatform = route.sourcePlatform === "Exercism overview"
                    ? "Exercism"
                    : route.sourcePlatform;
                const nextIdentity = getCodingPageIdentity(url, identityPlatform);

                if (previousIdentity && previousIdentity === nextIdentity) {
                    continue;
                }

                delete routes[key];
                changed = true;
            }

            if (changed) {
                await persistReturnRoutes(routes);
            }
        })
        .catch(error => {
            console.error("[workflow] return route invalidation ERROR:", error);
        });
}

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url === "string") {
        invalidateReturnRoutesForSourceUrlChange(tabId, changeInfo.url);
    }
});

chrome.webNavigation?.onHistoryStateUpdated?.addListener(details => {
    if (details.frameId === 0) {
        invalidateReturnRoutesForSourceUrlChange(details.tabId, details.url);
    }
});

chrome.webNavigation?.onReferenceFragmentUpdated?.addListener(details => {
    if (details.frameId === 0) {
        invalidateReturnRoutesForSourceUrlChange(details.tabId, details.url);
    }
});

chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
    loadReturnRoutes()
        .then(async routes => {
            let changed = false;

            for (const [key, route] of Object.entries(routes)) {
                if (route.llmTabId === tabId) {
                    delete routes[key];
                    changed = true;
                    continue;
                }

                if (
                    route.sourceTabId === tabId &&
                    route.windowId === removeInfo.windowId
                ) {
                    routes[key] = {
                        ...route,
                        sourceTabId: null,
                        status: "orphaned"
                    };
                    changed = true;
                }
            }

            if (changed) {
                returnRoutes = routes;
                const value = { [RETURN_ROUTES_KEY]: routes };
                await chrome.storage?.local?.set?.(value);
                await chrome.storage?.session?.set?.(value);
            }
        })
        .catch(error => {
            console.error("[workflow] return route cleanup ERROR:", error);
        });
});

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

    if (message?.type === "exercism-test-submit") {
        runExercismTestSubmit(sender.tab?.id).catch(error => {
            console.error("[exercism] test and submit ERROR:", error);
        });
        return;
    }

    if (message?.type === "exercism-run-tests-clicked") {
        const tabId = sender.tab?.id;

        if (tabId) {
            runExercismTestSubmit(tabId, { skipRun: true }).catch(error => {
                console.error("[exercism] manual test and submit ERROR:", error);
            });
        }

        return;
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

    if (message?.type === "llm-copy") {
        recordLlmCopy(sender.tab?.id, message.text).catch(error => {
            console.error("[llm] copy tracking ERROR:", error);
        });
        return;
    }

    if (message?.type !== "exercism-mark-complete") {
        return;
    }

    const tabId = sender.tab?.id;
    if (!tabId) {
        console.error("[exercism] mark complete ERROR: sender tab not found.");
        sendResponse({ completed: false });
        return;
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
});