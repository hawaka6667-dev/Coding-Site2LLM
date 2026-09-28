/* @machine
file: tests/exercism/edit/manual-run-submit.test.js
role: verify Ctrl+Enter capture and tab-scoped submission
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR, loadCoreWorker } = require("../../worker-test-harness.js");

test("routes Ctrl+Enter submission to the Exercism tab that sent the message", async () => {
    const context = loadCoreWorker();
    const tabLookups = [];
    let finishSubmission;
    context.chrome.tabs.get = async tabId => {
        tabLookups.push(tabId);
        return {
            id: tabId,
            url: "https://exercism.org/tracks/python/exercises/pov/edit"
        };
    };
    context.submissionFinished = new Promise(resolve => {
        finishSubmission = resolve;
    });
    context.finishSubmission = finishSubmission;
    vm.runInContext(
        "ExercismAdapter.testAndSubmit = async tabId => { submittedTabId = tabId; finishSubmission(); }",
        context
    );
    context.submittedTabId = null;

    context.messageListeners[0](
        { type: "exercism-test-submit" },
        { tab: { id: 42, url: "https://exercism.org/tracks/python/exercises/pov/edit" } }
    );
    await context.submissionFinished;

    assert.deepEqual(tabLookups, [42]);
    assert.equal(context.submittedTabId, 42);
});

test("captures Ctrl+Enter in the Exercism editor and sends the submit message", () => {
    const listeners = [];
    const messages = [];
    const context = vm.createContext({
        document: {
            addEventListener: (type, listener, capture) =>
                listeners.push({ type, listener, capture })
        },
        chrome: {
            runtime: {
                sendMessage: message => messages.push(message)
            }
        }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "edit", "content.js"),
            "utf8"
        ),
        context
    );
    const prevented = [];
    const event = {
        key: "Enter",
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        preventDefault: () => prevented.push("default"),
        stopPropagation: () => prevented.push("propagation"),
        stopImmediatePropagation: () => prevented.push("immediate")
    };

    listeners[0].listener(event);

    assert.equal(listeners[0].type, "keydown");
    assert.equal(listeners[0].capture, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "exercism-test-submit");
    assert.deepEqual(prevented, ["default", "propagation", "immediate"]);
});
