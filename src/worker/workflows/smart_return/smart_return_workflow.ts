/* @machine
file: worker/workflows/smart_return/smart_return_workflow.js
role: orchestrate serialized Smart Return cycles against maintained routes
contract: only consume the route revision selected for the current LLM tab cycle
*/

namespace SmartReturn {
    const runningCycles = new Map<number, Promise<void>>();
    const RETURN_PAYLOAD_RETRY_COUNT = 2;
    const RETURN_PAYLOAD_RETRY_DELAY_MS = 100;      //点两下的修复

    function waitForReturnPayloadRetry() {
        return new Promise(resolve => setTimeout(resolve, RETURN_PAYLOAD_RETRY_DELAY_MS));
    }

    async function returnToCodingPage(
        llmTab: chrome.tabs.Tab,
        operationId: string
    ) {
        const route = await routes.get(llmTab.windowId, llmTab.id);

        if (!route) {
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

        const targetTab = sourceTab;

        if (!targetTab?.id) {
            const cleared = await routes.clearIfCurrent(route);
            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                cleared ? "route.invalidated" : "workflow.skipped",
                {
                    reason: cleared ? "source-tab-unavailable" : "route-changed",
                    sourceTabId: route.sourceTabId
                }
            );
            return;
        }

        let routedRoute: Route | null = await routes.updateIfCurrent(route, {
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

        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "target.selected",
            { platform: route.sourcePlatform || "", sourceTabId: targetTab.id }
        );

        try {
            let clipboardText = await readClipboard(llmTab.id);
            let copiedText = routedRoute.copiedText || clipboardText;
            let paste = routedRoute.copied
                ? copiedText
                : isLikelyCode(clipboardText)
                    ? clipboardText
                    : "";

            for (let attempt = 0; !paste && attempt < RETURN_PAYLOAD_RETRY_COUNT; attempt += 1) {
                await waitForReturnPayloadRetry();
                const latestRoute = await routes.get(llmTab.windowId, llmTab.id);
                if (!latestRoute || latestRoute.sourceTabId !== targetTab.id) {
                    break;
                }

                routedRoute = latestRoute;
                clipboardText = await readClipboard(llmTab.id);
                copiedText = routedRoute.copiedText || clipboardText;
                paste = routedRoute.copied
                    ? copiedText
                    : isLikelyCode(clipboardText)
                        ? clipboardText
                        : "";
            }

            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                "clipboard.checked",
                { hasPayload: !!paste, sourceTabId: targetTab.id }
            );

            await chrome.tabs.update(targetTab.id, { active: true });

            if (paste) {
                await replaceCode(targetTab.id, paste);
                (globalThis as any).CodingSite2LlmDiagnostics.log(
                    "smart-return",
                    operationId,
                    "code.replaced",
                    { platform: route.sourcePlatform || "", sourceTabId: targetTab.id }
                );
                void submitReturnedCode(targetTab.id)
                    .then(() => {
                        (globalThis as any).CodingSite2LlmDiagnostics.log(
                            "smart-return",
                            operationId,
                            "adapter-submit.completed",
                            { sourceTabId: targetTab.id }
                        );
                    })
                    .catch(error => {
                        (globalThis as any).CodingSite2LlmDiagnostics.log(
                            "smart-return",
                            operationId,
                            "adapter-submit.failed",
                            {
                                sourceTabId: targetTab.id,
                                errorName: error instanceof Error ? error.name : "UnknownError"
                            }
                        );
                    });
                (globalThis as any).CodingSite2LlmDiagnostics.log(
                    "smart-return",
                    operationId,
                    "adapter-submit.started",
                    { platform: route.sourcePlatform || "", sourceTabId: targetTab.id }
                );
            }
        } finally {
            await routes.clearCopiedPayloadIfCurrent(routedRoute);
        }
    }

    export async function run(
        llmTab: chrome.tabs.Tab,
        operationId = (globalThis as any).CodingSite2LlmDiagnostics.createOperationId()
    ) {
        const tabId = llmTab.id;
        const existingCycle = runningCycles.get(tabId);

        if (existingCycle) {
            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                "workflow.skipped",
                { reason: "already-running", targetTabId: tabId }
            );
            return;
        }

        (globalThis as any).CodingSite2LlmDiagnostics.log(
            "smart-return",
            operationId,
            "workflow.started",
            { targetTabId: tabId }
        );
        const startedAt = performance.now();
        const cycle = returnToCodingPage(llmTab, operationId);
        runningCycles.set(tabId, cycle);

        try {
            await cycle;
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
            if (runningCycles.get(tabId) === cycle) {
                runningCycles.delete(tabId);
            }
        }
    }
}