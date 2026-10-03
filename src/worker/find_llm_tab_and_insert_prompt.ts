/* @machine
file: worker/find_llm_tab_and_insert_prompt.js
role: find nearby LLM tab and insert captured prompt
owns: provider-specific tab and input behavior
*/

async function findLlmTab(
    currentTab: chrome.tabs.Tab,
    preferredProvider: LlmProvider = LLM_PROVIDERS[0]
) {
    const tabs = await chrome.tabs.query({ windowId: currentTab.windowId });
    const leftOfCurrent = tabs
        .filter(tab => tab.id !== currentTab.id && typeof tab.index === "number")
        .filter(tab => tab.index < currentTab.index)
        .sort((left, right) => right.index - left.index);

    const existingTab = leftOfCurrent.find(tab =>
        preferredProvider.match(tab.url || "")
    );

    if (existingTab) {
        return { tab: existingTab, provider: preferredProvider };
    }

    const tab = await chrome.tabs.create({
        windowId: currentTab.windowId,
        index: currentTab.index,
        url: preferredProvider.url,
        active: false
    });
    return { tab, provider: preferredProvider };
}

async function focusLlmInput(tabId: number) {
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

async function waitForLlmInput(tabId: number, timeout = 30000) {
    const start = performance.now();

    while (performance.now() - start < timeout) {
        if (await focusLlmInput(tabId)) {
            return;
        }

        await sleep(100);
    }

    throw new Error("LLM input not found.");
}

async function insertText(tabId: number, text: string) {
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
        throw new Error("Could not insert text into LLM input.");
    }
}