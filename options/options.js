const DEFAULT_SETTINGS = Object.freeze({
    exercismOpenNewExerciseInEditor: true,
    exercismAutoSubmitAfterManualRun: true,
    exercismAutoMarkComplete: true
});

const status = document.getElementById("status");
const controls = [...document.querySelectorAll("[data-setting]")];
let statusTimer = 0;

function showStatus(text) {
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        status.textContent = "";
    }, 2500);
}

async function renderSettings() {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));

    for (const control of controls) {
        const key = control.dataset.setting;
        control.checked = stored[key] !== false && DEFAULT_SETTINGS[key] === true;
    }
}

async function saveSetting(control) {
    const key = control.dataset.setting;
    await chrome.storage.local.set({ [key]: control.checked });
    showStatus("Settings saved");
}

for (const control of controls) {
    control.addEventListener("change", () => {
        saveSetting(control).catch(error => {
            showStatus("Could not save: " + (error?.message || error));
        });
    });
}

document.getElementById("reset").addEventListener("click", async () => {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    await renderSettings();
    showStatus("Defaults restored");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
        return;
    }

    for (const control of controls) {
        const change = changes[control.dataset.setting];
        if (change) {
            control.checked = change.newValue !== false;
        }
    }
});

renderSettings().catch(error => {
    showStatus("Could not load settings: " + (error?.message || error));
});
