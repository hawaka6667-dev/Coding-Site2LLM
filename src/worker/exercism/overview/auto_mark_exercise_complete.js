/* @machine
file: worker/exercism/overview/auto_mark_exercise_complete.js
role: request mark-complete chain when control appears
scope: overview behavior; editor documents preload the Turbo watcher
owns: independent from open_exercise_in_editor
events: turbo:load | turbo:render | MutationObserver
闭环已完成
*/

let completedUrl = "";
let requestInFlight = false;
let pendingCheck = false;
let retryUrl = "";
let retryCount = 0;
let retryTimer = null;
const AUTO_MARK_COMPLETE_SETTING_KEY = "exercismAutoMarkComplete";
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const EXERCISM_OVERVIEW_URL_PATTERN =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

function isExercismOverviewPage(url = location.href) {
    return EXERCISM_OVERVIEW_URL_PATTERN.test(url);
}

function requestMarkComplete() {
    if (requestInFlight) {
        pendingCheck = true;
        return;
    }

    const currentUrl = location.href;
    if (!isExercismOverviewPage(currentUrl)) {
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
    }

    if (completedUrl === currentUrl || retryTimer) {
        return;
    }

    requestInFlight = true;

    void (async () => {
        const pageUrl = currentUrl;

        try {
            const stored = await chrome.storage.local.get(AUTO_MARK_COMPLETE_SETTING_KEY);
            if (location.href !== pageUrl) {
                pendingCheck = true;
                return;
            }
            if (stored[AUTO_MARK_COMPLETE_SETTING_KEY] === false) {
                return;
            }

            const button = [...document.querySelectorAll("button")].find(candidate =>
                candidate.offsetWidth > 0 &&
                candidate.offsetHeight > 0 &&
                !candidate.disabled &&
                candidate.getAttribute?.("aria-disabled") !== "true" &&
                /mark as complete/i.test(candidate.innerText.trim())
            );

            if (!button) {
                return;
            }

            const sendMessage = globalThis.chrome?.runtime?.sendMessage;
            if (typeof sendMessage !== "function") {
                scheduleRetry(pageUrl);
                return;
            }

            const response = await sendMessage.call(globalThis.chrome.runtime, {
                type: "exercism-mark-complete"
            });

            if (location.href !== pageUrl) {
                pendingCheck = true;
            } else if (response?.completed === true) {
                completedUrl = pageUrl;
                retryCount = 0;
            } else {
                scheduleRetry(pageUrl);
            }
        } catch (_) {
            scheduleRetry(pageUrl);
        } finally {
            requestInFlight = false;

            if (pendingCheck) {
                pendingCheck = false;
                requestMarkComplete();
            }
        }
    })();
}

function scheduleRetry(pageUrl) {
    if (location.href !== pageUrl || completedUrl === pageUrl || retryTimer) {
        return;
    }

    if (retryUrl !== pageUrl) {
        retryUrl = pageUrl;
        retryCount = 0;
    }

    const delay = RETRY_DELAYS_MS[retryCount];
    if (delay === undefined) {
        return;
    }

    retryCount += 1;
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
        if (areaName === "local" && changes[AUTO_MARK_COMPLETE_SETTING_KEY]) {
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