/* @machine
file: tests/exercism/overview/auto-mark-complete.test.js
role: verify Exercism automatic completion
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR, loadRoutingWorker, loadExercismOverviewScript } = require("../../worker-test-harness.js");

test("rechecks Exercism auto-completion after Turbo navigation", async () => {
    const documentListeners = new Map();
    const messages = [];
    let hasMarkComplete = false;
    const button = {
        innerText: "Mark as complete",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false
    };
    const document = {
        documentElement: {},
        addEventListener: (type, listener) => documentListeners.set(type, listener),
        querySelectorAll: () => hasMarkComplete ? [button] : []
    };
    class MutationObserver {
        observe() {}
    }
    const context = vm.createContext({
        chrome: {
            storage: { local: { get: async () => ({}) } },
            runtime: { sendMessage: message => messages.push(message) }
        },
        document,
        location: { href: "https://exercism.org/tracks/go/exercises/example/edit" },
        MutationObserver,
        console
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "overview", "auto_mark_exercise_complete.js"),
            "utf8"
        ),
        context
    );
    await new Promise(resolve => setImmediate(resolve));

    hasMarkComplete = true;
    context.location.href = "https://exercism.org/tracks/go/exercises/example";
    documentListeners.get("turbo:load")();
    await new Promise(resolve => setImmediate(resolve));

    documentListeners.get("turbo:render")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 1);

    context.location.href = "https://exercism.org/tracks/go/exercises/another-example";
    documentListeners.get("turbo:load")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 2);
    assert.equal(messages.every(message => message.type === "exercism-mark-complete"), true);
});

test("completed in-progress pages stay on overview when the control renders during the first check", async () => {
    let resolveStorage;
    const storageRead = new Promise(resolve => {
        resolveStorage = resolve;
    });
    const chrome = {
        storage: {
            local: {
                get: async () => {
                    await storageRead;
                    return {};
                }
            },
            onChanged: { addListener: () => {} }
        }
    };
    const buttons = [];
    const document = {
        documentElement: null,
        addEventListener: () => {},
        querySelector: () => ({
            getAttribute: () => JSON.stringify({
                status: "iterated",
                editor_enabled: true
            })
        }),
        querySelectorAll: selector => selector === "button"
            ? buttons
            : []
    };
    const context = loadExercismOverviewScript(document, chrome);
    vm.runInContext(
        "location.href = 'https://exercism.org/tracks/go/exercises/example'; openExercismEditorWhenOverviewHasNothingToConfirm()",
        context
    );
    buttons.push({
        innerText: "Mark as complete",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false
    });
    vm.runInContext(
        "openExercismEditorWhenOverviewHasNothingToConfirm()",
        context
    );
    resolveStorage();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(vm.runInContext("sessionStorage.entries.size", context), 0);
});

test("completes the Exercism overview condition-to-modal-to-result flow", async () => {
    const worker = loadRoutingWorker();
    let status = "iterated";
    let markCompleteAvailable = false;
    let confirmationModalVisible = false;
    let completionResultVisible = false;
    let markClicks = 0;
    let confirmClicks = 0;
    let overviewMutationCallback;
    const messages = [];
    const events = [];
    const reloadedTabIds = [];
    const removedTabIds = worker.removedTabs;
    const markButton = {
        innerText: "Mark as complete",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false,
        click: () => {
            markClicks += 1;
            events.push("mark-clicked");
            confirmationModalVisible = true;
            events.push("confirmation-modal-opened");
        }
    };
    const confirmButton = {
        innerText: "Confirm",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false,
        click: () => {
            confirmClicks += 1;
            events.push("confirm-clicked");
            confirmationModalVisible = false;
            setTimeout(() => {
                completionResultVisible = true;
                events.push("completion-result-output");
            }, 250);
        }
    };
    worker.document = {
        querySelector: () => ({
            getAttribute: () => JSON.stringify({ status })
        }),
        querySelectorAll: selector => {
            if (selector === "h1, h2, h3, h4") {
                return [{
                    innerText: "Exercise Solved",
                    offsetWidth: 100,
                    offsetHeight: 30
                }];
            }

            if (selector === "button") {
                if (confirmationModalVisible) return [confirmButton];
                return markCompleteAvailable ? [markButton] : [];
            }

            if (selector === "dialog, [role='dialog']") {
                return completionResultVisible
                    ? [{
                        innerText: "You've completed Hello World",
                        offsetWidth: 600,
                        offsetHeight: 400
                    }]
                    : [];
            }

            return [];
        }
    };
    worker.chrome.storage = {
        local: { get: async () => ({}) }
    };
    worker.chrome.scripting.executeScript = async ({ func, args }) => [{
        result: await func(...args)
    }];
    worker.chrome.tabs.query = async () => [
        { id: 1, url: "https://exercism.org/tracks/sqlite/concepts" },
        { id: 2, url: "https://exercism.org/tracks/rust/concepts" },
        { id: 3, url: "https://exercism.org/tracks/sqlite/concepts/?view=all" }
    ];
    worker.chrome.tabs.reload = async tabId => {
        reloadedTabIds.push(tabId);
        events.push(completionResultVisible
            ? `concepts-reloaded-after-result-${tabId}`
            : `concepts-reloaded-before-result-${tabId}`);
    };
    worker.chrome.tabs.remove = async tabId => {
        removedTabIds.push(tabId);
        events.push(`overview-closed-${tabId}`);
    };

    const documentListeners = new Map();
    const pageDocument = {
        documentElement: {},
        addEventListener: (type, listener) => documentListeners.set(type, listener),
        querySelectorAll: selector => selector === "button" && markCompleteAvailable
            ? [markButton]
            : []
    };
    const pageContext = vm.createContext({
        chrome: {
            storage: { local: { get: async () => ({}) } },
            runtime: {
                sendMessage: message => {
                    messages.push(message);
                    for (const listener of worker.messageListeners) {
                        listener(message, {
                            tab: {
                                id: 10,
                                url: "https://exercism.org/tracks/sqlite/exercises/hello-world"
                            }
                        }, () => {});
                    }
                }
            }
        },
        document: pageDocument,
        location: {
            href: "https://exercism.org/tracks/sqlite/exercises/hello-world"
        },
        MutationObserver: class {
            constructor(callback) {
                overviewMutationCallback = callback;
            }
            observe() {}
        }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "overview", "auto_mark_exercise_complete.js"),
            "utf8"
        ),
        pageContext
    );

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(messages, []);

    markCompleteAvailable = true;
    overviewMutationCallback();

    const deadline = Date.now() + 1000;
    while (removedTabIds.length < 1 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.equal(status, "iterated");
    assert.equal(completionResultVisible, true);
    assert.equal(markClicks, 1);
    assert.equal(confirmClicks, 1);
    assert.deepEqual(
        messages.map(message => message.type),
        ["exercism-mark-complete"]
    );
    assert.deepEqual(reloadedTabIds, [1, 3]);
    assert.deepEqual(removedTabIds, [10]);
    assert.ok(
        events.indexOf("completion-result-output") <
            events.indexOf("concepts-reloaded-after-result-1"),
        "the completion result must be visible before concepts refresh"
    );
    assert.ok(
        events.indexOf("concepts-reloaded-after-result-3") <
            events.indexOf("overview-closed-10"),
        "the overview must close after the concepts refresh"
    );
});
