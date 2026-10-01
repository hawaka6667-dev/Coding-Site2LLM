/* @machine
file: worker/diagnostics.js
role: centralize workflow diagnostics without logging user content
owns: operation IDs, detail allowlisting and service-worker console output
does_not_own: workflow control flow or persistence
contract: correlate structured events without logging page or user content
*/

(() => {
    const LOGGER_KEY = "CodingSite2LlmDiagnostics";
    const MESSAGE_TYPE = "coding-site2llm-diagnostic";
    const PREFIX = "[CodingSite2LLM]";
    const DETAIL_KEYS = new Set([
        "attempt",
        "durationMs",
        "errorName",
        "hasPayload",
        "platform",
        "provider",
        "reason",
        "result",
        "skipRun",
        "sourceTabId",
        "tabId",
        "targetTabId"
    ]);
    const CONTEXT_FIELDS = new Set([
        "title",
        "description",
        "source",
        "language",
        "feedback"
    ]);

    function createOperationId() {
        return globalThis.crypto?.randomUUID?.() ||
            `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function sanitizeDetails(details) {
        if (!details || typeof details !== "object") {
            return {};
        }

        const safeDetails = Object.fromEntries(
            Object.entries(details).filter(([key, value]) =>
                DETAIL_KEYS.has(key) &&
                (typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean")
            )
        );

        if (details.contextFields && typeof details.contextFields === "object") {
            safeDetails.contextFields = Object.fromEntries(
                Object.entries(details.contextFields)
                    .filter(([field, value]) =>
                        CONTEXT_FIELDS.has(field) &&
                        value &&
                        typeof value === "object"
                    )
                    .map(([field, value]) => [field, {
                        present: value.present === true,
                        length: Number.isFinite(value.length)
                            ? Math.max(0, value.length)
                            : 0
                    }])
            );
        }

        return safeDetails;
    }

    function log(workflow, operationId, stage, details = {}) {
        const event = {
            timestamp: new Date().toISOString(),
            operationId,
            workflow,
            stage,
            details: sanitizeDetails(details)
        };

        if (typeof document === "undefined") {
            write(event);
            return;
        }

        try {
            const response = chrome.runtime.sendMessage({
                type: MESSAGE_TYPE,
                event
            });
            response?.catch?.(() => console.info(PREFIX, event));
        } catch (_) {
            console.info(PREFIX, event);
        }
    }

    function write(event, senderTabId) {
        if (!event || typeof event !== "object") {
            return;
        }

        const details = {
            ...sanitizeDetails(event.details),
            ...(Number.isInteger(senderTabId) ? { tabId: senderTabId } : {})
        };
        console.info(PREFIX, {
            timestamp: typeof event.timestamp === "string"
                ? event.timestamp
                : new Date().toISOString(),
            operationId: typeof event.operationId === "string"
                ? event.operationId.slice(0, 80)
                : "unknown",
            workflow: typeof event.workflow === "string"
                ? event.workflow.slice(0, 80)
                : "unknown",
            stage: typeof event.stage === "string"
                ? event.stage.slice(0, 80)
                : "unknown",
            details
        });
    }

    globalThis[LOGGER_KEY] = Object.freeze({ createOperationId, log, write });
})();