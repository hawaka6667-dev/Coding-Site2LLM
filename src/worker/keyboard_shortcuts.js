/* @machine
file: worker/keyboard_shortcuts.js
role: page-local configurable shortcut bridge
contract: shortcuts are stored by Options and forwarded to the service worker
*/

const DEFAULT_SHORTCUTS = Object.freeze({
    "send-context": ["Alt+Q", "Mouse5"],
    "smart-return": ["Alt+Q", "Mouse5"]
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
const SHORTCUT_HELD_STALE_TIMEOUT_MS = 1000;
let shortcutHeld = false;
let heldShortcut = "";
let shortcutHeldAt = 0;
let shortcuts = normalizeShortcuts();

function shortcutMatches(event, shortcut) {
    if (!shortcut) {
        return false;
    }

    if (shortcut === "Mouse4" || shortcut === "Mouse5") {
        return event.type === "mousedown" && event.button === (shortcut === "Mouse4" ? 3 : 4);
    }
    if (event.type === "mousedown") {
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
            normalizeShortcutList(saved[name] ?? legacyShortcut ?? DEFAULT_SHORTCUTS[name])
        ])
    );
}

function normalizeShortcutList(value) {
    const bindings = Array.isArray(value) ? value : value ? [value] : [];
    return bindings.filter(binding => typeof binding === "string").slice(0, 2);
}

function getReleaseToken(binding) {
    return binding.startsWith("Mouse")
        ? `mouse:${binding}`
        : `key:${getBindingKey(binding).toUpperCase()}`;
}

function triggerShortcut(event, command, binding) {
    shortcutHeld = true;
    heldShortcut = binding;
    shortcutHeldAt = Date.now();
    event.preventDefault();
    event.stopPropagation();
    try {
        const message = {
            type: "keyboard-shortcut",
            command,
            releaseToken: getReleaseToken(binding)
        };
        const selectedText = command === "send-context"
            ? window.getSelection()?.toString() || ""
            : "";
        if (selectedText.trim()) {
            message.selectedText = selectedText;
        }
        chrome.runtime.sendMessage(message);
    } catch (_) {
        shortcutHeld = false;
        heldShortcut = "";
        shortcutHeldAt = 0;
    }
}

function releaseShortcut() {
    const releaseToken = getReleaseToken(heldShortcut);
    shortcutHeld = false;
    heldShortcut = "";
    shortcutHeldAt = 0;
    sendShortcutRelease(releaseToken);
}

function sendShortcutRelease(releaseToken) {
    try {
        chrome.runtime.sendMessage({
            type: "keyboard-shortcut-release",
            releaseToken
        });
    } catch (_) {
        // The extension context may disappear while an existing tab remains open.
    }
}

function getBindingKey(binding) {
    const parts = binding.split("+");
    while (["Ctrl", "Alt", "Shift", "Meta"].includes(parts[0])) {
        parts.shift();
    }
    return parts.join("+");
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
    if (event.repeat) {
        return;
    }

    if (shortcutHeld) {                 //按两下bug
        if (Date.now() - shortcutHeldAt < SHORTCUT_HELD_STALE_TIMEOUT_MS) {
            return;
        }
        releaseShortcut();
    }

    const command = LLM_HOSTS.has(location.hostname)
        ? "smart-return"
        : "send-context";
    const binding = shortcuts[command].find(shortcut => shortcutMatches(event, shortcut));
    if (!binding) {
        return;
    }

    triggerShortcut(event, command, binding);
}, true);

document.addEventListener("mousedown", event => {
    if (shortcutHeld) {
        return;
    }

    const command = LLM_HOSTS.has(location.hostname)
        ? "smart-return"
        : "send-context";
    const binding = shortcuts[command].find(shortcut => shortcutMatches(event, shortcut));
    if (binding) {
        triggerShortcut(event, command, binding);
    }
}, true);

document.addEventListener("keyup", event => {
    const releasedKey = getEventKey(event).toUpperCase();

    if (shortcutHeld && !heldShortcut.startsWith("Mouse")) {
        if (releasedKey === getBindingKey(heldShortcut).toUpperCase()) {
            releaseShortcut();
        }
        return;
    }

    const matchingBinding = Object.values(shortcuts)
        .flat()
        .find(binding => !binding.startsWith("Mouse") &&
            releasedKey === getBindingKey(binding).toUpperCase());

    if (matchingBinding) {
        sendShortcutRelease(getReleaseToken(matchingBinding));
    }
}, true);

window.addEventListener?.("focus", () => {
    if (shortcutHeld) {
        releaseShortcut();
    }
});

window.addEventListener?.("blur", () => {        //手动回llm点两下问题
    if (shortcutHeld) {
        releaseShortcut();
    }
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && shortcutHeld) {
        releaseShortcut();
    }
}, true);

document.addEventListener("mouseup", event => {
    if (shortcutHeld && heldShortcut.startsWith("Mouse")) {
        if (event.button === (heldShortcut === "Mouse4" ? 3 : 4)) {
            releaseShortcut();
        }
        return;
    }

    const matchingBinding = Object.values(shortcuts)
        .flat()
        .find(binding => binding === (event.button === 3 ? "Mouse4" : "Mouse5"));

    if (matchingBinding) {
        sendShortcutRelease(getReleaseToken(matchingBinding));
    }
}, true);
