/* @machine
file: popup/smart_return_target.js
role: show and change the Smart Return target tab from the popup
contract: talk to the worker only through smart-return-get-target/set-target messages
*/
(() => {
    const section = document.getElementById("smart-return-target");
    const select = document.getElementById("smart-return-target-select");
    const label = document.getElementById("smart-return-target-current");
    const hint = document.getElementById("smart-return-target-hint");
    if (!section || !select || !label || !hint) {
        return;
    }

    let llmTabId = null;
    let currentTabId = null;

    const tabLabel = tab => tab.title || tab.url;

    function render(state) {
        llmTabId = state.llmTabId;
        currentTabId = state.target ? state.target.tabId : null;
        label.textContent = state.target ? tabLabel(state.target) : "None";
        label.title = state.target ? state.target.url : "";
        select.disabled = llmTabId === null;
        hint.textContent = llmTabId === null
            ? "Open this popup from an LLM tab to change the target."
            : "";

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Change target…";
        const options = state.candidates.map(tab => {
            const option = document.createElement("option");
            option.value = String(tab.tabId);
            option.textContent = tabLabel(tab);
            return option;
        });
        select.replaceChildren(placeholder, ...options);
        select.value = "";
    }

    async function load() {
        const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });
        if (!activeTab) {
            return;
        }

        const state = await chrome.runtime.sendMessage({
            type: "smart-return-get-target",
            windowId: activeTab.windowId,
            activeTabId: activeTab.id
        });
        if (!state?.ok) {
            throw new Error(state?.error || "Could not read the Smart Return target.");
        }
        render(state);
    }

    select.addEventListener("change", async () => {
        const sourceTabId = Number(select.value);
        if (!select.value || llmTabId === null || sourceTabId === currentTabId) {
            select.value = "";
            return;
        }

        select.disabled = true;
        try {
            const response = await chrome.runtime.sendMessage({
                type: "smart-return-set-target",
                llmTabId,
                sourceTabId
            });
            if (!response?.ok) {
                throw new Error(response?.error || "Could not change the target.");
            }
            await load();
        } catch (error) {
            hint.textContent = "Failed: " + (error?.message || error);
            select.disabled = false;
            select.value = "";
        }
    });

    load().catch(error => {
        hint.textContent = String(error?.message || error);
    });
})();
