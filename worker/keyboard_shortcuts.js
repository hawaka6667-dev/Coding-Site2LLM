/* @machine
file: worker/keyboard_shortcuts.js
role: page-local configurable shortcut bridge
contract: shortcuts are stored by Options and forwarded to the service worker
*/

const DEFAULT_SHORTCUTS = Object.freeze({
    "send-context": "Alt+Q",
    "smart-return": "Alt+Q"
});
const SHORTCUTS_KEY = "codingSite2LlmShortcuts";
const LLM_HOSTS = new Set([
    "chat.deepseek.com",
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "deepai.org"
]);
let shortcutHeld = false;
let shortcuts = { ...DEFAULT_SHORTCUTS };

function shortcutMatches(event, shortcut) {
    if (!shortcut) {
        return false;
    }

    const parts = shortcut.split("+");
    const modifiers = new Set();
    while (["Ctrl", "Alt", "Shift", "Meta"].includes(parts[0])) {
        modifiers.add(parts.shift());
    }
    const key = parts.join("+");

    const eventKey = getEventKey(event);

    return eventKey.toUpperCase() === key.toUpperCase()
        && event.ctrlKey === modifiers.has("Ctrl")
        && event.altKey === modifiers.has("Alt")
        && event.shiftKey === modifiers.has("Shift")
        && event.metaKey === modifiers.has("Meta");
}

function getEventKey(event) {
    return /^Key[A-Z]$/.test(event.code)
        ? event.code.slice(3)
        : /^Digit[0-9]$/.test(event.code)
            ? event.code.slice(5)
            : event.key;
}

function normalizeShortcuts(saved = {}) {
    const legacyShortcut = saved["run-workflow"];
    return Object.fromEntries(
        Object.keys(DEFAULT_SHORTCUTS).map(name => [
            name,
            saved[name] ?? legacyShortcut ?? DEFAULT_SHORTCUTS[name]
        ])
    );
}

chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SHORTCUTS_KEY]) {
        shortcuts = normalizeShortcuts(changes[SHORTCUTS_KEY].newValue);
    }
});

chrome.storage.local.get(SHORTCUTS_KEY)
    .then(stored => {
        shortcuts = normalizeShortcuts(stored[SHORTCUTS_KEY]);
    })
    .catch(() => {});

document.addEventListener("keydown", event => {
    if (event.repeat || shortcutHeld) {
        return;
    }

    const command = LLM_HOSTS.has(location.hostname)
        ? "smart-return"
        : "send-context";
    if (!shortcutMatches(event, shortcuts[command])) {
        return;
    }

    shortcutHeld = true;
    event.preventDefault();
    event.stopPropagation();
    try {
        chrome.runtime.sendMessage({ type: "keyboard-shortcut", command });
    } catch (_) {
        shortcutHeld = false;
    }
}, true);

document.addEventListener("keyup", event => {
    if (!shortcutHeld) {
        return;
    }

    const matchesShortcut = Object.values(shortcuts).some(shortcut => {
        const key = shortcut?.split("+").at(-1);
        return key && getEventKey(event).toUpperCase() === key.toUpperCase();
    });

    if (matchesShortcut) {
        shortcutHeld = false;
        try {
            chrome.runtime.sendMessage({ type: "keyboard-shortcut-release" });
        } catch (_) {
            // The extension context may disappear while an existing tab remains open.
        }
    }
}, true);
