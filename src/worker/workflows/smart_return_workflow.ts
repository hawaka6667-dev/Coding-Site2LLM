/* @machine
file: worker/workflows/smart_return_workflow.js
role: serialize Smart Return cycles and write copied code to the maintained source tab
contract: finish or fail the current cycle before allowing another on the same LLM tab
warning: Coordinate cycle changes with worker/state/return_route_store.ts; guard every write based on a captured route revision
*/

const smartReturnPromises = new Map<string, Promise<void>>();

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

async function returnToCodingPage(
    llmTab: chrome.tabs.Tab,
    operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId()
) {
    const routes = await loadReturnRoutes();
    const routeKey = getReturnRouteKey(llmTab.windowId, llmTab.id);
    let route = routes[routeKey];

    if (
        !route ||
        route.windowId !== llmTab.windowId ||
        route.llmTabId !== llmTab.id
    ) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.skipped",
            { reason: "missing-route", targetTabId: llmTab.id }
        );
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
            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                "route.invalidated",
                { reason: "source-identity-changed", sourceTabId: route.sourceTabId }
            );
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
        const orphanedRoute = await saveReturnRouteIfCurrent(route, {
            sourceTabId: null,
            status: "orphaned"
        });
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.skipped",
            {
                reason: orphanedRoute ? "no-matching-target" : "route-changed",
                platform: targetPlatform
            }
        );
        return;
    }

    const routedRoute = await saveReturnRouteIfCurrent(route, {
        sourceTabId: targetTab.id,
        status: "routed"
    });
    if (!routedRoute) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.skipped",
            { reason: "route-changed", sourceTabId: targetTab.id }
        );
        return;
    }
    route = routedRoute;
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "smart-return",
        operationId,
        "target.selected",
        { platform: targetPlatform, sourceTabId: targetTab.id }
    );

    const clipboardText = await readClipboard(llmTab.id);
    const copiedText = route.copiedText || clipboardText;
    const paste = route.copied
        ? copiedText
        : isLikelyCode(clipboardText)
            ? clipboardText
            : "";
    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "smart-return",
        operationId,
        "clipboard.checked",
        { hasPayload: !!paste, sourceTabId: targetTab.id }
    );

    await chrome.tabs.update(targetTab.id, { active: true });

    try {
        if (paste) {
            await replaceCode(targetTab.id, paste);
            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                "code.replaced",
                { platform: targetPlatform, sourceTabId: targetTab.id }
            );
            await submitReturnedCode(targetTab.id);
            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                "code.submitted",
                { platform: targetPlatform, sourceTabId: targetTab.id }
            );
        }
    } finally {
        await clearCopiedPayloadIfCurrent(route);
    }
}

async function runSmartReturn(
    llmTab: chrome.tabs.Tab,
    operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId()
) {
    const routeKey = getReturnRouteKey(llmTab.windowId, llmTab.id);

    if (smartReturnPromises.has(routeKey)) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.skipped",
            { reason: "already-running", targetTabId: llmTab.id }
        );
        console.warn("[workflow] Smart Return already running; ignoring duplicate trigger.");
        return;
    }

    (globalThis as any).CodingSite2LlmDiagnostics.log(
        "smart-return",
        operationId,
        "workflow.started",
        { targetTabId: llmTab.id }
    );
    const startedAt = performance.now();
    const promise = returnToCodingPage(llmTab, operationId);
    smartReturnPromises.set(routeKey, promise);

    try {
        await promise;
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.completed",
            { durationMs: Math.round(performance.now() - startedAt) }
        );
    } catch (error) {
        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.failed",
            { errorName: error instanceof Error ? error.name : "UnknownError" }
        );
        throw error;
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