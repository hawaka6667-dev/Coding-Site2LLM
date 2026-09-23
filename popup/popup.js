/* @machine
file: popup/popup.js
role: own popup actions and persist user settings
contract: default_popup owns send; sync Exercism redirect key with overview script
*/
const EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY =
    "exercismOpenNewExerciseInEditor";
const SELECTED_LLM_PROVIDER_KEY = "selectedLlmProvider";
const DEFAULT_LLM_PROVIDER = "DeepSeek";

const toggle = document.getElementById("exercism-open-new-exercise-in-editor");
const providerSelect = document.getElementById("llm-provider");
const sendButton = document.getElementById("send-context");
const optionsButton = document.getElementById("open-options");
const status = document.getElementById("status");

let statusTimer = 0;

function showStatus(text, sticky = false) {
    status.textContent = text;
    clearTimeout(statusTimer);

    if (!sticky) {
        statusTimer = setTimeout(() => {
            status.textContent = "";
        }, 4000);
    }
}

async function renderToggle() {
    const stored = await chrome.storage.local.get(
        EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY
    );

    // Unset means the feature is on; the default lives in the content script.
    toggle.checked =
        stored[EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY] !== false;
}

async function renderProvider() {
    const stored = await chrome.storage.local.get(SELECTED_LLM_PROVIDER_KEY);
    const value = stored[SELECTED_LLM_PROVIDER_KEY] || DEFAULT_LLM_PROVIDER;

    providerSelect.value = [...providerSelect.options].some(option =>
        option.value === value
    ) ? value : DEFAULT_LLM_PROVIDER;
}

providerSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({
        [SELECTED_LLM_PROVIDER_KEY]: providerSelect.value
    });

    showStatus(`LLM: ${providerSelect.value}`);
});

toggle.addEventListener("change", async () => {
    await chrome.storage.local.set({
        [EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY]: toggle.checked
    });

    showStatus(toggle.checked ? "Enabled" : "Disabled");
});

sendButton.addEventListener("click", async () => {
    sendButton.disabled = true;
    showStatus("Sending…", true);

    try {
        const response = await chrome.runtime.sendMessage({
            type: "run-workflow"
        });

        if (!response?.ok) {
            throw new Error(response?.error || "The workflow did not report success.");
        }

        showStatus("Sent to the LLM tab.");
    } catch (error) {
        showStatus("Failed: " + (error?.message || error), true);
    } finally {
        sendButton.disabled = false;
    }
});

optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

renderToggle();
renderProvider();
