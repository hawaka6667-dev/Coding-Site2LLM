/* @machine
file: tests/exercism/submitted-overview/window-lifecycle.test.js
role: verify submitted overview window creation and URL boundaries
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadRoutingWorker } = require("../../worker-test-harness.js");

test("opens a submitted overview in a new window and rejects unrelated URLs", async () => {
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
    const navigations = [];
    context.chrome.tabs.query = async () => [overviewTab];

    context.chrome.tabs.update = async (tabId, update) => {
        navigations.push({ tabId, update });
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
    const rejected = await sendWorkerMessage({
        type: "exercism-create-submitted-overview-window",
        overviewUrl: "https://example.com/tracks/go/exercises/lasagna",
        editorUrl: editorTab.url
    }, editorTab);
    assert.equal(rejected?.opened, false);
    assert.equal(context.createdWindows.length, 1);
});
