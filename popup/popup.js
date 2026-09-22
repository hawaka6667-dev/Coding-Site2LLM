/*
 * Responsibility: extension popup - the toggle for the Exercism overview
 * redirect, plus the send action that the popup now owns.
 *
 * A default_popup replaces chrome.action.onClicked, so "send context to the
 * LLM" is triggered from the button here instead of from an icon click.
 */

/* Setting: keep this key in sync with
 * worker/open_new_exercism_exercise_in_editor.js. */
const EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY =
    "exercismOpenNewExerciseInEditor";

const toggle = document.getElementById("exercism-open-new-exercise-in-editor");
const sendButton = document.getElementById("send-context");
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

renderToggle();
