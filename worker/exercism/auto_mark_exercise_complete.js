/* @machine
file: worker/exercism/auto_mark_exercise_complete.js
role: request mark-complete chain when control appears
owns: independent from open_exercise_in_editor
events: turbo:load | turbo:render | MutationObserver
*/

let requested = false;
const AUTO_MARK_COMPLETE_SETTING_KEY = "exercismAutoMarkComplete";

async function requestMarkComplete() {
    if (requested) {
        return;
    }

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

    requested = true;
    const sendMessage = globalThis.chrome?.runtime?.sendMessage;
    if (typeof sendMessage !== "function") {
        requested = false;
        return;
    }

    try {
        sendMessage.call(globalThis.chrome.runtime, {
            type: "exercism-mark-complete"
        });
    } catch (_) {
        requested = false;
    }
}

function startWatching() {
    requestMarkComplete();
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