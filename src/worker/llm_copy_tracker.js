/* @machine
file: worker/llm_copy_tracker.js
role: track explicit copy actions on supported LLM pages
*/

document.addEventListener("copy", event => {
    const selectedText = window.getSelection()?.toString() || "";
    const copiedText = event.clipboardData?.getData("text/plain") || selectedText;

    const sendMessage = globalThis.chrome?.runtime?.sendMessage;
    if (typeof sendMessage !== "function") {
        return;
    }

    try {
        sendMessage.call(globalThis.chrome.runtime, {
            type: "llm-copy",
            text: copiedText
        });
    } catch (_) {
        // The extension context may disappear while an existing tab remains open.
    }
}, true);