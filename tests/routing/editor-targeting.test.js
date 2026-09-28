/* @machine
file: tests/routing/editor-targeting.test.js
role: verify coding-tab and active-editor targeting
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadRoutingWorker } = require("../worker-test-harness.js");

test("Smart Return skips a LeetCode submissions tab and targets the problem editor", () => {
    const context = loadRoutingWorker();
    const tabs = [
        { id: 1, index: 0, url: "https://chat.deepseek.com/" },
        {
            id: 2,
            index: 1,
            url: "https://leetcode.com/problems/dota2-senate/submissions/2154894608/?envType=study-plan-v2&envId=leetcode-75"
        },
        {
            id: 3,
            index: 2,
            url: "https://leetcode.com/problems/dota2-senate/?envType=study-plan-v2&envId=leetcode-75"
        }
    ];

    assert.equal(
        vm.runInContext(
            "findRightCodingTab(tabs, tabs[0], 'LeetCode').id",
            vm.createContext({ ...context, tabs })
        ),
        3
    );
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
