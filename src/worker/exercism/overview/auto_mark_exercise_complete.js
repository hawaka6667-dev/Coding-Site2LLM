/* @machine
file: worker/exercism/overview/auto_mark_exercise_complete.js
role: request mark-complete chain when control appears
scope: overview behavior; editor documents preload the Turbo watcher
owns: independent from open_exercise_in_editor
events: turbo:load | turbo:render | MutationObserver
*/

let completedUrl = "";
let requestInFlight = false;
let pendingCheck = false;
let retryUrl = "";
let retryCount = 0;
let retryTimer = null;
let autoCompleteOperationId = "";
let waitingForMarkCompleteLogged = false;
let autoCompleteDisabledLogged = false;
const AUTO_MARK_COMPLETE_STORAGE_KEY = "exercismAutoMarkComplete";
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const AUTO_MARK_COMPLETE_OVERVIEW_URL_PATTERN =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

function isExercismOverviewPage(url = location.href) {
    return AUTO_MARK_COMPLETE_OVERVIEW_URL_PATTERN.test(url);
}

function logExercismAutoCompleteDiagnostic(stage, details = {}) {
    const diagnostics = globalThis.CodingSite2LlmDiagnostics;
    if (!diagnostics) {
        return "";
    }

    if (!autoCompleteOperationId) {
        autoCompleteOperationId = diagnostics.createOperationId();
    }

    diagnostics.log(
        "exercism-mark-complete",
        autoCompleteOperationId,
        stage,
        details
    );
    return autoCompleteOperationId;
}

function requestMarkComplete() {
    if (requestInFlight) {
        pendingCheck = true;
        return;
    }

    const currentUrl = location.href;
    if (!isExercismOverviewPage(currentUrl)) {
        if (autoCompleteOperationId) {
            logExercismAutoCompleteDiagnostic("workflow.cancelled", {
                reason: "left-overview"
            });
        }
        autoCompleteOperationId = "";
        if (retryTimer) {
            clearTimeout(retryTimer);
        }
        retryTimer = null;
        retryUrl = "";
        retryCount = 0;
        return;
    }

    if (retryUrl !== currentUrl) {
        if (retryTimer) {
            clearTimeout(retryTimer);
        }
        retryTimer = null;
        retryUrl = currentUrl;
        retryCount = 0;
        autoCompleteOperationId = "";
        waitingForMarkCompleteLogged = false;
        autoCompleteDisabledLogged = false;
        logExercismAutoCompleteDiagnostic("watch.started", {
            platform: "Exercism"
        });
    }

    if (completedUrl === currentUrl || retryTimer) {
        return;
    }

    requestInFlight = true;

    void (async () => {
        const pageUrl = currentUrl;

        try {
            const stored = await chrome.storage.local.get(AUTO_MARK_COMPLETE_STORAGE_KEY);
            if (location.href !== pageUrl) {
                pendingCheck = true;
                return;
            }
            if (stored[AUTO_MARK_COMPLETE_STORAGE_KEY] === false) {
                if (!autoCompleteDisabledLogged) {
                    autoCompleteDisabledLogged = true;
                    logExercismAutoCompleteDiagnostic("workflow.skipped", {
                        reason: "setting-disabled"
                    });
                }
                return;
            }
            autoCompleteDisabledLogged = false;

            const button = [...document.querySelectorAll("button")].find(candidate =>
                candidate.offsetWidth > 0 &&
                candidate.offsetHeight > 0 &&
                !candidate.disabled &&
                candidate.getAttribute?.("aria-disabled") !== "true" &&
                /mark as complete/i.test(candidate.innerText.trim())
            );

            if (!button) {
                if (!waitingForMarkCompleteLogged) {
                    waitingForMarkCompleteLogged = true;
                    logExercismAutoCompleteDiagnostic("control.waiting", {
                        reason: "button-not-ready"
                    });
                }
                return;
            }
            waitingForMarkCompleteLogged = false;
            logExercismAutoCompleteDiagnostic("control.ready", {
                platform: "Exercism"
            });

            const sendMessage = globalThis.chrome?.runtime?.sendMessage;
            if (typeof sendMessage !== "function") {
                scheduleRetry(pageUrl, "message-unavailable");
                return;
            }

            const operationId = autoCompleteOperationId;
            logExercismAutoCompleteDiagnostic("request.sent");
            const response = await sendMessage.call(globalThis.chrome.runtime, {
                type: "exercism-mark-complete",
                operationId
            });

            if (location.href !== pageUrl) {
                logExercismAutoCompleteDiagnostic("workflow.cancelled", {
                    reason: "route-changed"
                });
                pendingCheck = true;
            } else if (response?.completed === true) {
                completedUrl = pageUrl;
                retryCount = 0;
                logExercismAutoCompleteDiagnostic("workflow.completed", {
                    result: "confirmed"
                });
            } else {
                scheduleRetry(pageUrl, "worker-not-confirmed");
            }
        } catch (error) {
            logExercismAutoCompleteDiagnostic("request.failed", {
                errorName: error instanceof Error ? error.name : "UnknownError"
            });
            scheduleRetry(pageUrl, "request-error");
        } finally {
            requestInFlight = false;

            if (pendingCheck) {
                pendingCheck = false;
                requestMarkComplete();
            }
        }
    })();
}

function scheduleRetry(pageUrl, reason) {
    if (location.href !== pageUrl || completedUrl === pageUrl || retryTimer) {
        return;
    }

    if (retryUrl !== pageUrl) {
        retryUrl = pageUrl;
        retryCount = 0;
    }

    const delay = RETRY_DELAYS_MS[retryCount];
    if (delay === undefined) {
        logExercismAutoCompleteDiagnostic("workflow.failed", {
            reason: "retry-limit-reached"
        });
        autoCompleteOperationId = "";
        return;
    }

    retryCount += 1;
    logExercismAutoCompleteDiagnostic("retry.scheduled", {
        attempt: retryCount,
        reason
    });
    retryTimer = setTimeout(() => {
        retryTimer = null;
        requestMarkComplete();
    }, delay);
}

function observeMarkCompleteChanges() {
    if (retryTimer && [...document.querySelectorAll("button")].some(candidate =>
        candidate.offsetWidth > 0 &&
        candidate.offsetHeight > 0 &&
        !candidate.disabled &&
        candidate.getAttribute?.("aria-disabled") !== "true" &&
        /mark as complete/i.test(candidate.innerText.trim())
    )) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    requestMarkComplete();
}

function startWatching() {
    requestMarkComplete();
    document.addEventListener("turbo:load", observeMarkCompleteChanges);
    document.addEventListener("turbo:render", observeMarkCompleteChanges);
    chrome.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName === "local" && changes[AUTO_MARK_COMPLETE_STORAGE_KEY]) {
            observeMarkCompleteChanges();
        }
    });
    new MutationObserver(observeMarkCompleteChanges).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-disabled", "class", "disabled", "hidden", "style"],
        characterData: true
    });
}

if (document.documentElement) {
    startWatching();
} else {
    document.addEventListener("DOMContentLoaded", startWatching, { once: true });
}