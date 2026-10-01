/* @machine
file: tests/exercism/submitted-overview/window-lifecycle.test.js
role: verify submitted overview ownership and cleanup boundaries
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadRoutingWorker } = require("../../worker-test-harness.js");

test("registers before navigation and closes only the matching owned overview", async () => {
    const editorTab = {
        id: 7,
        windowId: 3,
        url: "https://exercism.org/tracks/go/exercises/lasagna/edit"
    };
    const overviewTab = {
        id: 21,
        windowId: 21,
        url: "https://exercism.org/tracks/go/exercises/lasagna?from=submit"
    };
    const context = loadRoutingWorker({ tabs: [editorTab] });
    const events = [];
    const persisted = {};
    const removedWindows = [];
    const navigations = [];
    context.chrome.tabs.query = async () => [overviewTab];

    context.chrome.storage.session = {
        get: async key => ({ [key]: persisted[key] }),
        set: async values => {
            Object.assign(persisted, values);
            events.push("registered");
        }
    };
    context.chrome.windows.remove = async windowId => {
        removedWindows.push(windowId);
    };
    context.chrome.tabs.update = async (tabId, update) => {
        navigations.push({ tabId, update });
        events.push("navigated");
    };

    function sendWorkerMessage(message, tab) {
        return new Promise(resolve => {
            let handled = false;
            for (const listener of context.messageListeners) {
                if (listener(message, { tab }, resolve) === true) {
                    handled = true;
                    break;
                }
            }
            if (!handled) {
                resolve(undefined);
            }
        });
    }

    const overviewUrl =
        "https://exercism.org/tracks/go/exercises/lasagna?from=submit";
    const opened = await sendWorkerMessage({
        type: "exercism-create-submitted-overview-window",
        overviewUrl,
        editorUrl: editorTab.url
    }, editorTab);

    assert.equal(opened?.opened, true);
    assert.equal(context.createdWindows.length, 1);
    assert.equal(context.createdWindows[0].url, "about:blank");
    assert.equal(context.createdWindows[0].focused, false);
    assert.equal(navigations.length, 1);
    assert.equal(navigations[0].tabId, overviewTab.id);
    assert.equal(navigations[0].update.url, overviewUrl);
    assert.deepEqual(events, ["registered", "navigated"]);

    const wrongExercise = await sendWorkerMessage({
        type: "exercism-close-submitted-overview-window"
    }, {
        ...overviewTab,
        url: "https://exercism.org/tracks/go/exercises/other"
    });
    assert.equal(wrongExercise?.closed, false);
    assert.deepEqual(removedWindows, []);

    const closed = await sendWorkerMessage({
        type: "exercism-close-submitted-overview-window"
    }, {
        ...overviewTab,
        url: "https://exercism.org/tracks/go/exercises/lasagna"
    });
    assert.equal(closed?.closed, true);
    assert.deepEqual(removedWindows, [overviewTab.windowId]);
    assert.deepEqual(
        Object.keys(persisted.codingSite2LlmSubmittedOverviewWindows),
        []
    );

    const rejected = await sendWorkerMessage({
        type: "exercism-create-submitted-overview-window",
        overviewUrl: "https://example.com/tracks/go/exercises/lasagna",
        editorUrl: editorTab.url
    }, editorTab);
    assert.equal(rejected?.opened, false);
    assert.equal(context.createdWindows.length, 1);
});