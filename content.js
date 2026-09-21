/*
 * Responsibility: Exercism keyboard bridge only.
 * Ctrl+Enter is intercepted before the editor can insert a newline, then
 * sends a message; button automation belongs in
 * worker/extract_coding_site_context_with_site_adapters.js.
 * Chrome commands cannot bind Enter.
 * 
 * WARNING有关这个功能的代码改了极其容易出事，已经好几次拓展其他功能而失效因此回档了，请慎重考虑方案
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
    chrome.runtime.sendMessage({ type: "exercism-test-submit" });
}, true);