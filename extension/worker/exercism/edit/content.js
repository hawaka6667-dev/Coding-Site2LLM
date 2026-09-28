/* @machine
file: worker/exercism/edit/content.js
role: Exercism Ctrl+Enter bridge to service worker
owns: keyboard capture only; button automation belongs to site adapter
contract: Chrome commands cannot bind Enter
risk: high; changes here have regressed extension behavior before
*/

document.addEventListener("keydown", event => {
    if (
        event.key !== "Enter" ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
    ) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const sendMessage = globalThis.chrome?.runtime?.sendMessage;
    if (typeof sendMessage !== "function") {
        return;
    }

    try {
        sendMessage.call(globalThis.chrome.runtime, {
            type: "exercism-test-submit"
        });
    } catch (_) {
        // The extension context may disappear while an existing tab remains open.
    }
}, true);