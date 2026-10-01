/* @machine
file: tests/routing/editor-targeting.test.js
role: verify active-editor targeting
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadRoutingWorker } = require("../worker-test-harness.js");

test("clears a closed source route without activating a replacement tab", async () => {
    const tabs = [
        { id: 1, windowId: 7, index: 0, url: "https://chat.deepseek.com/" },
        { id: 2, windowId: 7, index: 1, url: "https://leetcode.com/problems/two-sum/" },
        { id: 3, windowId: 7, index: 2, url: "https://leetcode.com/problems/two-sum/" }
    ];
    const context = loadRoutingWorker({ tabs });
    const activatedTabIds = [];
    context.chrome.tabs.update = async tabId => activatedTabIds.push(tabId);

    await context.SmartReturn.routes.save({
        windowId: 7,
        llmTabId: 1,
        sourceTabId: 2,
        sourceUrl: "https://leetcode.com/problems/two-sum/",
        sourcePlatform: "LeetCode",
        sourceIdentity: "LeetCode:two-sum",
        status: "routed",
        copied: true,
        copiedText: "return 42;"
    });
    await context.SmartReturn.routes.removeTab(2, 7);

    await context.SmartReturn.run(tabs[0], "operation-1");

    assert.deepEqual(activatedTabIds, []);
    assert.equal(await context.SmartReturn.routes.get(7, 1), null);
});

test("writes returned code to the active LeetCode editor after switching list problems", async () => {
    const context = loadRoutingWorker();
    const oldProblemModel = {
        value: "old problem source",
        setValue(value) { this.value = value; },
        getValue() { return this.value; }
    };
    const activeProblemModel = {
        value: "new problem source",
        setValue(value) { this.value = value; },
        getValue() { return this.value; }
    };
    const hiddenNode = { offsetWidth: 0, offsetHeight: 0 };
    const activeNode = { offsetWidth: 800, offsetHeight: 500 };
    const activeEditor = {
        getDomNode: () => activeNode,
        getModel: () => activeProblemModel,
        focus() {}
    };

    context.document = {
        activeElement: { closest: () => activeNode }
    };
    context.window = {
        monaco: {
            editor: {
                getEditors: () => [
                    { getDomNode: () => hiddenNode, getModel: () => oldProblemModel },
                    activeEditor
                ],
                getModels: () => [oldProblemModel, activeProblemModel]
            }
        }
    };
    context.chrome.scripting.executeScript = async ({ func, args }) => [
        { result: await func(...args) }
    ];

    await vm.runInContext(
        "getPlatform('https://leetcode.com/problems/next-problem/').replaceCode(7, 'returned solution')",
        context
    );

    assert.equal(oldProblemModel.value, "old problem source");
    assert.equal(activeProblemModel.value, "returned solution");
});

test("ignores zero-layout LeetCode Monaco editors with small nonzero offsets", async () => {
    const context = loadRoutingWorker();
    const hiddenProblemModel = {
        value: "old problem source",
        setValue(value) { this.value = value; },
        getValue() { return this.value; }
    };
    const activeProblemModel = {
        value: "new problem source",
        setValue(value) { this.value = value; },
        getValue() { return this.value; }
    };
    const hiddenNode = {
        isConnected: true,
        offsetWidth: 5,
        offsetHeight: 5,
        getBoundingClientRect: () => ({ width: 0, height: 0 })
    };
    const activeNode = {
        isConnected: true,
        offsetWidth: 800,
        offsetHeight: 500,
        getBoundingClientRect: () => ({ width: 800, height: 500 })
    };
    const activeEditor = {
        getDomNode: () => activeNode,
        getModel: () => activeProblemModel,
        focus() {}
    };

    context.document = { activeElement: null };
    context.window = {
        monaco: {
            editor: {
                getEditors: () => [
                    { getDomNode: () => hiddenNode, getModel: () => hiddenProblemModel },
                    activeEditor
                ],
                getModels: () => [hiddenProblemModel, activeProblemModel]
            }
        }
    };
    context.chrome.scripting.executeScript = async ({ func, args }) => [
        { result: await func(...args) }
    ];

    await vm.runInContext(
        "getPlatform('https://leetcode.com/problems/odd-even-linked-list/').replaceCode(7, 'returned solution')",
        context
    );

    assert.equal(hiddenProblemModel.value, "old problem source");
    assert.equal(activeProblemModel.value, "returned solution");
});

test("waits for the LeetCode Monaco editor to mount after switching problems", async () => {
    const context = loadRoutingWorker();
    const activeProblemModel = {
        value: "new problem source",
        setValue(value) { this.value = value; },
        getValue() { return this.value; }
    };
    const oldProblemModel = {
        value: "old problem source",
        setValue(value) { this.value = value; },
        getValue() { return this.value; }
    };
    const activeNode = { offsetWidth: 800, offsetHeight: 500 };
    const activeEditor = {
        getDomNode: () => activeNode,
        getModel: () => activeProblemModel,
        focus() {}
    };
    let editorReady = false;

    context.document = { activeElement: null };
    context.window = {
        monaco: {
            editor: {
                getEditors: () => editorReady ? [activeEditor] : [],
                getModels: () => editorReady
                    ? [oldProblemModel, activeProblemModel]
                    : [oldProblemModel]
            }
        }
    };
    context.chrome.scripting.executeScript = async ({ func, args }) => [
        { result: await func(...args) }
    ];
    setTimeout(() => { editorReady = true; }, 25);

    await vm.runInContext(
        "getPlatform('https://leetcode.com/problems/next-problem/').replaceCode(7, 'returned solution')",
        context
    );

    assert.equal(oldProblemModel.value, "old problem source");
    assert.equal(activeProblemModel.value, "returned solution");
});
