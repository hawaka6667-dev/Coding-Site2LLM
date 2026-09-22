/*
 * Automatically asks the service worker to complete an Exercism overview
 * page when its Mark as complete control becomes available.
 */

let requested = false;

function requestMarkComplete() {
    if (requested) {
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
    chrome.runtime.sendMessage({ type: "exercism-mark-complete" });
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