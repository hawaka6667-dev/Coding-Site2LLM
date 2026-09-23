/* @machine
file: worker/run_coding_context_to_llm_workflow.js
role: coordinate end-to-end workflow and Chrome listeners
contract: no website selectors or page-specific extraction
*/

let workflowPromise = null;
let returnRoutes = null;
let keyboardShortcutHeld = false;
let keyboardShortcutReleaseTimer = null;
const exercismSubmitPromises = new Map();
const RETURN_ROUTE_KEY = "codingSite2LlmReturnRoute";
const RETURN_ROUTES_KEY = "codingSite2LlmReturnRoutes";
const SELECTED_LLM_PROVIDER_KEY = "selectedLlmProvider";
const KEYBOARD_SHORTCUT_LOCK_TIMEOUT_MS = 10000;

async function getSelectedLlmProvider() {
    const stored = await chrome.storage.local.get(SELECTED_LLM_PROVIDER_KEY);
    return LLM_PROVIDERS.find(provider =>
        provider.name === stored[SELECTED_LLM_PROVIDER_KEY]
    ) || LLM_PROVIDERS[0];
}

async function saveReturnRoute(route) {
    const routes = await loadReturnRoutes();
    const key = getReturnRouteKey(route.windowId, route.llmTabId);
    routes[key] = route;
    returnRoutes = routes;
    const value = { [RETURN_ROUTES_KEY]: routes };
    await chrome.storage?.local?.set?.(value);
    await chrome.storage?.session?.set?.(value);
}

async function loadReturnRoute() {
    const routes = await loadReturnRoutes();
    const tabs = await chrome.tabs.query({});
    const activeLlmTab = tabs.find(tab => tab.active && isLlmUrl(tab.url));
    return activeLlmTab
        ? routes[getReturnRouteKey(activeLlmTab.windowId, activeLlmTab.id)] || null
        : null;
}

function getReturnRouteKey(windowId, llmTabId) {
    return `${windowId}:${llmTabId}`;
}

function normalizeReturnRoute(route) {
    if (!route || typeof route !== "object") {
        return null;
    }

    let sourcePlatform = route.sourcePlatform;

    if (!sourcePlatform && route.sourceUrl) {
        try {
            sourcePlatform = getPlatform(route.sourceUrl).name;
        } catch (_) {
            sourcePlatform = "";
        }
    }

    return {
        ...route,
        sourcePlatform: sourcePlatform || "",
        status: route.status || (route.sourceTabId ? "routed" : "orphaned")
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

function isLlmUrl(url) {
    return LLM_PROVIDERS.some(provider => provider.match(url || ""));
}

async function readClipboard(tabId) {
    return executePage(tabId, async () => {
        try {
            return (await navigator.clipboard.readText()).trim();
        } catch (_) {
            return "";
        }
    });
}

function isLikelyCode(text) {
    const value = String(text || "").trim();

    if (!value || value.length < 3 || value.length > 100000) {
        return false;
    }

    return /(?:[{};]|=>|\b(?:const|let|var|function|return|class|def|import|from|public|private|if|for|while)\b|<!--[\s\S]*-->|^\s*#include\b)/m.test(value);
}

async function recordLlmCopy(tabId, text) {
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

async function replaceCode(tabId, text) {
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

async function submitCode(tabId) {
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

async function submitReturnedCode(tabId) {
    const sourceTab = await chrome.tabs.get?.(tabId);
    const platform = sourceTab?.url ? getPlatform(sourceTab.url) : null;

    if (typeof platform?.testAndSubmit === "function") {
        await platform.testAndSubmit(tabId);
        return;
    }

    await submitCode(tabId);
}

async function returnToCodingPage(llmTab) {
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
    const sourceIsValid = sourceTab &&
        isCodingTabForPlatform(sourceTab, route.sourcePlatform);
    const targetTab = sourceIsValid
        ? sourceTab
        : findRightCodingTab(tabs, llmTab, route.sourcePlatform);

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

    if (paste) {
        await replaceCode(targetTab.id, paste);
        await submitReturnedCode(targetTab.id);
    }

    await saveReturnRoute({
        ...route,
        copied: false,
        copiedText: ""
    });
}

function isCodingTabForPlatform(tab, sourcePlatform) {
    if (!tab?.id || !tab.url || sourcePlatform === "Web source") {
        return false;
    }

    try {
        const platform = getPlatform(tab.url);
        return platform.name === sourcePlatform && platform.name !== "Exercism overview";
    } catch (_) {
        return false;
    }
}

function findRightCodingTab(tabs, llmTab, sourcePlatform) {
    return tabs
        .filter(tab => typeof tab.index === "number" && tab.index > llmTab.index)
        .filter(tab => isCodingTabForPlatform(tab, sourcePlatform))
        .sort((left, right) => left.index - right.index)[0] || null;
}

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

async function runExercismTestSubmit(tabId, options) {
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

// Dormant while manifest.json sets action.default_popup (a popup swallows the
// icon click). Kept so removing the popup restores click-to-send unchanged.
chrome.action.onClicked.addListener(async () => {
    try {
        await runWorkflow();
    } catch (error) {
        console.error("[workflow] ERROR:", error);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "keyboard-shortcut-release") {
        keyboardShortcutHeld = false;
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
        keyboardShortcutReleaseTimer = setTimeout(() => {
            keyboardShortcutHeld = false;
            keyboardShortcutReleaseTimer = null;
        }, KEYBOARD_SHORTCUT_LOCK_TIMEOUT_MS);

        (async () => {
            if (command === "send-context") {
                await runWorkflow();
            } else if (command === "smart-return" && tab) {
                await returnToCodingPage(tab);
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
        runExercismTestSubmit().catch(error => {
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