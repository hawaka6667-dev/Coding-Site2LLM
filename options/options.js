const DEFAULT_SETTINGS = Object.freeze({
    exercismOpenNewExerciseInEditor: true,
    exercismAutoSubmitAfterManualRun: true,
    exercismAutoMarkComplete: true,
    exercismRefreshConceptsAfterComplete: true,
    iconTheme: "ice-cyan"
});
const DEFAULT_SHORTCUTS = Object.freeze({
    "send-context": ["Alt+Q"],
    "smart-return": ["Alt+Q"]
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
            normalizeShortcutList(savedShortcuts[name] ?? legacyShortcut ?? DEFAULT_SHORTCUTS[name])
        ])
    );

    for (const [name, bindings] of Object.entries(shortcuts)) {
        document.getElementById(`shortcut-${name}`).value = bindings[0] || "";
        document.getElementById(`shortcut-${name}-2-slot`).hidden = bindings.length < 2;
        document.getElementById(`shortcut-${name}-2`).value = bindings[1] || "";
        document.getElementById(`shortcut-${name}-add`).hidden = bindings.length >= 2;
    }
}

function normalizeShortcutList(value) {
    const bindings = Array.isArray(value) ? value : value ? [value] : [];
    return bindings.filter(binding => typeof binding === "string").slice(0, 2);
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

function getShortcutBindings(savedShortcuts) {
    const legacyShortcut = savedShortcuts["run-workflow"];
    return Object.fromEntries(
        Object.keys(DEFAULT_SHORTCUTS).map(name => [
            name,
            normalizeShortcutList(savedShortcuts[name] ?? legacyShortcut ?? DEFAULT_SHORTCUTS[name])
        ])
    );
}

async function saveShortcut(name, bindings) {
    const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
    const savedShortcuts = stored[SHORTCUTS_KEY] || {};
    const shortcuts = getShortcutBindings(savedShortcuts);
    shortcuts[name] = normalizeShortcutList(bindings);
    await chrome.storage.local.set({ [SHORTCUTS_KEY]: shortcuts });
}

let activeShortcutInput = null;

for (const name of Object.keys(DEFAULT_SHORTCUTS)) {
    const addButton = document.getElementById(`shortcut-${name}-add`);

    for (const index of [0, 1]) {
        const suffix = index === 0 ? "" : "-2";
        const input = document.getElementById(`shortcut-${name}${suffix}`);
        const error = document.getElementById(`shortcut-${name}-error${suffix}`);
        const removeButton = document.getElementById(`shortcut-${name}-remove${suffix}`);

        input.addEventListener("focus", () => {
            activeShortcutInput = { name, index, input, error };
            input.value = "";
            error.textContent = "Press a shortcut, mouse button 4/5, or Escape to cancel";
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

            await saveBinding(name, index, getShortcutString(event), input, error);
        });
        input.addEventListener("blur", () => {
            if (activeShortcutInput?.input === input) {
                activeShortcutInput = null;
            }
            error.textContent = "";
            renderShortcut().catch(() => {});
        });
        removeButton.addEventListener("click", async () => {
            try {
                const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
                const bindings = getShortcutBindings(stored[SHORTCUTS_KEY] || {})[name];
                bindings.splice(index, 1);
                await saveShortcut(name, bindings);
                await renderShortcut();
                showStatus("Shortcut removed");
            } catch (error) {
                showStatus("Could not remove shortcut: " + (error?.message || error));
            }
        });
    }

    addButton.addEventListener("click", async () => {
        try {
            const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
            const bindings = getShortcutBindings(stored[SHORTCUTS_KEY] || {})[name];
            if (bindings.length < 2) {
                if (bindings.length === 0) {
                    bindings.push("");
                } else {
                    bindings.push("");
                }
                await saveShortcut(name, bindings);
                await renderShortcut();
                document.getElementById(
                    `shortcut-${name}${bindings.length === 2 ? "-2" : ""}`
                ).focus();
            }
        } catch (error) {
            showStatus("Could not add shortcut: " + (error?.message || error));
        }
    });

}

async function saveBinding(name, index, value, input, error) {
    try {
        const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
        const bindings = getShortcutBindings(stored[SHORTCUTS_KEY] || {})[name];
        bindings[index] = value;
        await saveShortcut(name, bindings);
        input.value = value;
        error.textContent = "Saved";
        input.blur();
    } catch (saveError) {
        error.textContent = "Could not save: " + (saveError?.message || saveError);
    }
}

document.addEventListener("mousedown", async event => {
    if (!activeShortcutInput || ![3, 4].includes(event.button)) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    const value = event.button === 3 ? "Mouse4" : "Mouse5";
    await saveBinding(
        activeShortcutInput.name,
        activeShortcutInput.index,
        value,
        activeShortcutInput.input,
        activeShortcutInput.error
    );
}, true);

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
