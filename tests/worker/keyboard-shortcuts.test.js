/* @machine
file: tests/worker/keyboard-shortcuts.test.js
role: verify shortcut matching, dispatch, and release
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadCoreWorker, loadKeyboardShortcuts } = require("../worker-test-harness.js");

test("supports Alt and Shift in shortcut matching", () => {
    const { context } = loadKeyboardShortcuts();

    assert.equal(vm.runInContext(
        "shortcutMatches({ key: 'q', code: 'KeyQ', ctrlKey: false, altKey: true, shiftKey: true, metaKey: false }, 'Alt+Shift+Q')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ key: 'œ', code: 'KeyQ', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }, 'Alt+Q')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ key: 'Q', code: 'KeyQ', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false }, 'Shift+Q')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ key: ',', code: 'Comma', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, 'Ctrl+,')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ key: '；', code: 'Semicolon', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }, 'Alt+；')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ key: '+', code: 'Equal', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, 'Ctrl++')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ type: 'mousedown', button: 3 }, 'Mouse4')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "shortcutMatches({ type: 'mousedown', button: 4 }, 'Mouse5')",
        context
    ), true);
    assert.equal(vm.runInContext(
        "JSON.stringify(normalizeShortcuts({ 'send-context': 'Alt+K', 'smart-return': ['Mouse4', 'Mouse5', 'Ctrl+R'] }))",
        context
    ), JSON.stringify({ "send-context": ["Alt+K"], "smart-return": ["Mouse4", "Mouse5"] }));
});

test("defaults both shortcut actions to Alt+Q and Mouse5", async () => {
    const { context, listeners, messages } = loadKeyboardShortcuts();
    await Promise.resolve();

    assert.deepEqual(
        JSON.parse(vm.runInContext("JSON.stringify(shortcuts)", context)),
        { "send-context": ["Alt+Q", "Mouse5"], "smart-return": ["Alt+Q", "Mouse5"] }
    );

    listeners.find(listener => listener.type === "mousedown").listener({
        type: "mousedown",
        button: 4,
        preventDefault() {},
        stopPropagation() {}
    });
    assert.equal(messages[0].command, "send-context");
});

test("dispatches Smart Return synchronously on the first shortcut press", () => {
    const { listeners, messages } = loadKeyboardShortcuts("chat.deepseek.com");
    const keydown = listeners.find(listener => listener.type === "keydown").listener;
    let prevented = false;
    let stopped = false;

    keydown({
        key: "q",
        code: "KeyQ",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; }
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "keyboard-shortcut");
    assert.equal(messages[0].command, "smart-return");
});

test("blocks held-key repeats and allows another shortcut after keyup", () => {
    const { listeners, messages } = loadKeyboardShortcuts();
    const keydown = listeners.find(listener => listener.type === "keydown").listener;
    const keyup = listeners.find(listener => listener.type === "keyup").listener;
    const press = repeat => keydown({
        key: "q",
        code: "KeyQ",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        repeat,
        preventDefault() {},
        stopPropagation() {}
    });

    press(false);
    press(true);
    press(false);
    keyup({ key: "q", code: "KeyQ" });
    press(false);

    assert.deepEqual(messages.map(message => message.type), [
        "keyboard-shortcut",
        "keyboard-shortcut-release",
        "keyboard-shortcut"
    ]);
});

test("releases the worker lock when keyup lands in the newly focused page", () => {
    const { listeners, messages } = loadKeyboardShortcuts("chat.deepseek.com");
    const keyup = listeners.find(listener => listener.type === "keyup").listener;

    keyup({ key: "q", code: "KeyQ" });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "keyboard-shortcut-release");
    assert.equal(messages[0].releaseToken, "key:Q");
});

test("releases the worker lock when mouseup lands in the newly focused page", async () => {
    const { listeners, messages } = loadKeyboardShortcuts("chat.deepseek.com", {
        "send-context": ["Alt+Q"],
        "smart-return": ["Mouse4"]
    });
    await Promise.resolve();
    const mouseup = listeners.find(listener => listener.type === "mouseup").listener;

    mouseup({ button: 3 });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "keyboard-shortcut-release");
    assert.equal(messages[0].releaseToken, "mouse:Mouse4");
});

test("clears a stale page lock when the original page regains focus", () => {
    const { listeners, messages, windowListeners } = loadKeyboardShortcuts();
    const keydown = listeners.find(listener => listener.type === "keydown").listener;
    const focus = windowListeners.find(listener => listener.type === "focus").listener;
    const press = () => keydown({
        key: "q",
        code: "KeyQ",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        preventDefault() {},
        stopPropagation() {}
    });

    press();
    focus();
    press();

    assert.deepEqual(messages.map(message => message.type), [
        "keyboard-shortcut",
        "keyboard-shortcut-release",
        "keyboard-shortcut"
    ]);
});

test("includes selected page text in the send-context shortcut message", () => {
    const { listeners, messages } = loadKeyboardShortcuts(
        "example.com",
        {},
        "  selected problem text  "
    );
    const keydown = listeners.find(listener => listener.type === "keydown").listener;

    keydown({
        key: "q",
        code: "KeyQ",
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        preventDefault: () => {},
        stopPropagation: () => {}
    });

    assert.equal(messages[0].command, "send-context");
    assert.equal(messages[0].selectedText, "  selected problem text  ");
});

test("dispatches Mouse4 once and releases the shortcut on mouseup", async () => {
    const { listeners, messages } = loadKeyboardShortcuts("example.com", {
        "send-context": ["Alt+Q", "Mouse4"],
        "smart-return": ["Alt+Q"]
    });
    await Promise.resolve();
    const mousedown = listeners.find(listener => listener.type === "mousedown").listener;
    const mouseup = listeners.find(listener => listener.type === "mouseup").listener;
    let prevented = false;
    let stopped = false;
    const event = {
        type: "mousedown",
        button: 3,
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; }
    };

    mousedown(event);
    mousedown(event);
    mouseup({ type: "mouseup", button: 3 });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(messages.map(message => message.type), [
        "keyboard-shortcut",
        "keyboard-shortcut-release"
    ]);
    assert.equal(messages[0].command, "send-context");
});

test("service worker blocks duplicate shortcut messages until release", () => {
    const context = loadCoreWorker();
    let starts = 0;
    context.runWorkflow = async () => { starts += 1; };
    const onMessage = context.messageListeners[0];
    const sender = { tab: { id: 10 } };
    const shortcut = {
        type: "keyboard-shortcut",
        command: "send-context",
        releaseToken: "key:Q"
    };

    onMessage(shortcut, sender);
    onMessage(shortcut, sender);
    assert.equal(starts, 1);

    onMessage({ type: "keyboard-shortcut-release", releaseToken: "key:W" }, sender);
    onMessage(shortcut, sender);
    assert.equal(starts, 1);

    onMessage({ type: "keyboard-shortcut-release", releaseToken: "key:Q" }, sender);
    onMessage(shortcut, sender);
    assert.equal(starts, 2);

    onMessage({ type: "keyboard-shortcut-release", releaseToken: "key:Q" }, sender);
});
