/*
 * Responsibility: find the nearby LLM tab and insert captured content.
 * Provider-specific tab and input behavior belongs here.
 */

async function findLlmTab(currentTab) {
    const tabs = await chrome.tabs.query({ windowId: currentTab.windowId });
    const ordered = tabs
        .filter(tab => tab.id !== currentTab.id && typeof tab.index === "number")
        .sort((left, right) => right.index - left.index);
    const leftOfCurrent = ordered.filter(tab => tab.index < currentTab.index);
    const rightOfCurrent = ordered
        .filter(tab => tab.index > currentTab.index)
        .sort((left, right) => right.index - left.index);
    const candidates = [
        ...leftOfCurrent.sort((left, right) => right.index - left.index),
        ...rightOfCurrent
    ];

    for (const tab of candidates) {
        const provider = LLM_PROVIDERS.find(item => item.match(tab.url || ""));
        if (provider) {
            return { tab, provider };
        }
    }

    const provider = LLM_PROVIDERS[0];
    const tab = await chrome.tabs.create({
        windowId: currentTab.windowId,
        index: currentTab.index,
        url: provider.url,
        active: false
    });
    return { tab, provider };
}

async function focusDeepSeekInput(tabId) {
    const found = await executePage(tabId, selectors => {
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (element.offsetWidth > 0 && element.offsetHeight > 0) {
                    element.focus();
                    return true;
                }
            }
        }

        return false;
    }, [INPUT_SELECTORS]);

    return found === true;
}

async function waitForDeepSeekInput(tabId, timeout = 30000) {
    const start = performance.now();

    while (performance.now() - start < timeout) {
        if (await focusDeepSeekInput(tabId)) {
            return;
        }

        await sleep(100);
    }

    throw new Error("DeepSeek input not found.");
}

async function insertText(tabId, text) {
    const inserted = await executePage(tabId, value => {
        const input = document.activeElement;
        if (!input) {
            return false;
        }

        if (input.isContentEditable) {
            input.focus();
            document.execCommand("selectAll", false);
            if (!document.execCommand("insertText", false, value)) {
                input.textContent = value;
            }
        } else if ("value" in input) {
            const prototype = Object.getPrototypeOf(input);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
            if (descriptor?.set) {
                descriptor.set.call(input, value);
            } else {
                input.value = value;
            }
        } else {
            return false;
        }

        input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value
        }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }, [text]);

    if (inserted !== true) {
        throw new Error("Could not insert text into DeepSeek input.");
    }
}