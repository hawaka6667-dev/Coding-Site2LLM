/* @machine
file: worker/exercism/auto_mark_exercise_complete.js
role: request mark-complete chain when control appears
owns: independent from open_exercise_in_editor
events: turbo:load | turbo:render | MutationObserver
*/

let requestedUrl = "";
let requestInFlight = false;
const AUTO_MARK_COMPLETE_SETTING_KEY = "exercismAutoMarkComplete";

async function requestMarkComplete() {
    const pageUrl = location.href;

    if (requestedUrl === pageUrl || requestInFlight) {
        return;
    }

    requestInFlight = true;

    try {
        const stored = await chrome.storage.local.get(AUTO_MARK_COMPLETE_SETTING_KEY);
        if (stored[AUTO_MARK_COMPLETE_SETTING_KEY] === false) {
            return;
        }

        const button = [...document.querySelectorAll("button")].find(candidate =>
            candidate.offsetWidth > 0 &&
            candidate.offsetHeight > 0 &&
            !candidate.disabled &&
            /mark as complete/i.test(candidate.innerText.trim())
        );

        if (!button) {
            return;
        }

        const sendMessage = globalThis.chrome?.runtime?.sendMessage;
        if (typeof sendMessage !== "function") {
            return;
        }

        requestedUrl = pageUrl;
        const response = sendMessage.call(globalThis.chrome.runtime, {
            type: "exercism-mark-complete"
        });
        response?.catch?.(() => {
            if (requestedUrl === pageUrl) {
                requestedUrl = "";
            }
        });
    } catch (_) {
        if (requestedUrl === pageUrl) {
            requestedUrl = "";
        }
    } finally {
        requestInFlight = false;

        if (location.href !== pageUrl && requestedUrl !== location.href) {
            requestMarkComplete();
        }
    }
}

function startWatching() {
    requestMarkComplete();
    document.addEventListener("turbo:load", requestMarkComplete);
    document.addEventListener("turbo:render", requestMarkComplete);
    new MutationObserver(requestMarkComplete).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}

if (document.documentElement) {
    startWatching();
} else {
    document.addEventListener("DOMContentLoaded", startWatching, { once: true });
}