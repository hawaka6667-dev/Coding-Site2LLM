const DEFAULT_SETTINGS = Object.freeze({
    exercismOpenNewExerciseInEditor: true,
    exercismAutoSubmitAfterManualRun: true,
    exercismAutoMarkComplete: true,
    iconTheme: "ice-cyan"
});
const DEFAULT_SHORTCUTS = Object.freeze({
    "send-context": "Alt+Q",
    "smart-return": "Alt+Q"
});
const SHORTCUTS_KEY = "codingSite2LlmShortcuts";
const ICON_THEMES = ["ice-cyan", "warm-ivory", "mint", "lemon"];

const status = document.getElementById("status");
const controls = [...document.querySelectorAll("[data-setting]")];
const iconThemeControls = [...document.querySelectorAll("[data-icon-theme]")];
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

    const iconTheme = ICON_THEMES.includes(stored.iconTheme) ? stored.iconTheme : DEFAULT_SETTINGS.iconTheme;
    for (const control of iconThemeControls) {
        control.checked = control.value === iconTheme;
    }
}

async function renderShortcut() {
    const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
    const savedShortcuts = stored[SHORTCUTS_KEY] || {};
    const legacyShortcut = savedShortcuts["run-workflow"];
    const shortcuts = Object.fromEntries(
        Object.keys(DEFAULT_SHORTCUTS).map(name => [
            name,
            savedShortcuts[name] ?? legacyShortcut ?? DEFAULT_SHORTCUTS[name]
        ])
    );

    for (const [name, value] of Object.entries(shortcuts)) {
        document.getElementById(`shortcut-${name}`).value = value || "";
    }
}

function getShortcutKey(event) {
    if (/^Key[A-Z]$/.test(event.code)) {
        return event.code.slice(3);
    }
    if (/^Digit[0-9]$/.test(event.code)) {
        return event.code.slice(5);
    }
    return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function getShortcutString(event) {
    const modifiers = [];
    if (event.ctrlKey) modifiers.push("Ctrl");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");
    if (event.metaKey) modifiers.push("Meta");

    const key = getShortcutKey(event);
    return [...modifiers, key].join("+");
}

function isValidShortcut(event) {
    const key = getShortcutKey(event);
    return (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)
        && key.length === 1
        && !/\s/u.test(key);
}

async function saveShortcut(name, value) {
    const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
    const savedShortcuts = stored[SHORTCUTS_KEY] || {};
    const legacyShortcut = savedShortcuts["run-workflow"];
    const shortcuts = Object.fromEntries(
        Object.keys(DEFAULT_SHORTCUTS).map(shortcutName => [
            shortcutName,
            shortcutName === name
                ? value
                : (savedShortcuts[shortcutName] ?? legacyShortcut ?? DEFAULT_SHORTCUTS[shortcutName])
        ])
    );
    await chrome.storage.local.set({ [SHORTCUTS_KEY]: shortcuts });
}

for (const name of Object.keys(DEFAULT_SHORTCUTS)) {
    const input = document.getElementById(`shortcut-${name}`);
    const error = document.getElementById(`shortcut-${name}-error`);
    const removeButton = document.getElementById(`shortcut-${name}-remove`);
    const resetButton = document.getElementById(`shortcut-${name}-reset`);

    input.addEventListener("focus", () => {
        input.value = "";
        error.textContent = "Press a new shortcut, or Escape to cancel";
    });
    input.addEventListener("keydown", async event => {
        event.preventDefault();
        if (event.key === "Escape") {
            input.blur();
            return;
        }
        if (!isValidShortcut(event)) {
            error.textContent = "Include Ctrl, Alt, Shift, or Meta plus one printable character";
            return;
        }

        const value = getShortcutString(event);
        try {
            await saveShortcut(name, value);
            input.value = value;
            error.textContent = "Saved";
            input.blur();
        } catch (saveError) {
            error.textContent = "Could not save: " + (saveError?.message || saveError);
        }
    });
    input.addEventListener("blur", () => {
        error.textContent = "";
        renderShortcut().catch(() => {});
    });
    removeButton.addEventListener("click", async () => {
        try {
            await saveShortcut(name, "");
            await renderShortcut();
            showStatus("Shortcut removed");
        } catch (error) {
            showStatus("Could not remove shortcut: " + (error?.message || error));
        }
    });
    resetButton.addEventListener("click", async () => {
        try {
            await saveShortcut(name, DEFAULT_SHORTCUTS[name]);
            await renderShortcut();
            showStatus("Shortcut restored");
        } catch (error) {
            showStatus("Could not restore shortcut: " + (error?.message || error));
        }
    });
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

for (const control of iconThemeControls) {
    control.addEventListener("change", () => {
        if (!control.checked) {
            return;
        }

        chrome.storage.local.set({ iconTheme: control.value }).then(() => {
            showStatus("Icon skin saved");
        }).catch(error => {
            showStatus("Could not save icon skin: " + (error?.message || error));
        });
    });
}

document.getElementById("reset").addEventListener("click", async () => {
    try {
        await chrome.storage.local.set(DEFAULT_SETTINGS);
        await chrome.storage.local.set({ [SHORTCUTS_KEY]: { ...DEFAULT_SHORTCUTS } });
        await renderSettings();
        await renderShortcut();
        showStatus("Defaults restored");
    } catch (error) {
        showStatus("Could not restore defaults: " + (error?.message || error));
    }
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

    if (changes.iconTheme) {
        const iconTheme = ICON_THEMES.includes(changes.iconTheme.newValue)
            ? changes.iconTheme.newValue
            : DEFAULT_SETTINGS.iconTheme;
        for (const control of iconThemeControls) {
            control.checked = control.value === iconTheme;
        }
    }
});

Promise.all([renderSettings(), renderShortcut()]).catch(error => {
    showStatus("Could not load settings: " + (error?.message || error));
});
