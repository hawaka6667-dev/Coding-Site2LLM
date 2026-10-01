/* @machine
file: worker/workflows/smart_return/smart_return_workflow.js
role: orchestrate serialized Smart Return cycles against maintained routes
contract: only consume the route revision selected for the current LLM tab cycle
*/

namespace SmartReturn {
    const runningCycles = new Map<number, Promise<void>>();

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
        const maintainedIdentity = route.sourceIdentity || getCodingPageIdentity(
            route.sourceUrl || "",
            route.sourcePlatform || ""
        );

        if (sourceTab?.url && maintainedIdentity) {
            const sourceIdentity = getCodingPageIdentity(
                sourceTab.url,
                route.sourcePlatform || ""
            );

            if (!sourceIdentity || sourceIdentity !== maintainedIdentity) {
                const cleared = await routes.clearIfCurrent(route);
                (globalThis as any).CodingSite2LlmDiagnostics.log(
                    "smart-return",
                    operationId,
                    cleared ? "route.invalidated" : "workflow.skipped",
                    {
                        reason: cleared ? "source-identity-changed" : "route-changed",
                        sourceTabId: route.sourceTabId
                    }
                );
                return;
            }
        }

        const targetTab = sourceTab;

        if (!targetTab?.id) {
            const orphanedRoute = await routes.updateIfCurrent(route, {
                sourceTabId: null,
                status: "orphaned"
            });
            (globalThis as any).CodingSite2LlmDiagnostics.log(
                "smart-return",
                operationId,
                "workflow.skipped",
                {
                    reason: orphanedRoute ? "source-tab-unavailable" : "route-changed",
                    sourceTabId: route.sourceTabId
                }
            );
            return;
        }

        const routedRoute = await routes.updateIfCurrent(route, {
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
            const clipboardText = await readClipboard(llmTab.id);
            const copiedText = routedRoute.copiedText || clipboardText;
            const paste = routedRoute.copied
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

            if (paste) {
                await replaceCode(targetTab.id, paste);
                (globalThis as any).CodingSite2LlmDiagnostics.log(
                    "smart-return",
                    operationId,
                    "code.replaced",
                    { platform: route.sourcePlatform || "", sourceTabId: targetTab.id }
                );
                await submitReturnedCode(targetTab.id);
                (globalThis as any).CodingSite2LlmDiagnostics.log(
                    "smart-return",
                    operationId,
                    "code.submitted",
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