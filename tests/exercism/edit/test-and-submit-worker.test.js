/* @machine
file: tests/exercism/edit/test-and-submit-worker.test.js
role: verify Exercism editor test-and-submit lifecycle
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadCoreWorker } = require("../../worker-test-harness.js");

test("uses the Exercism test-and-submit adapter after replacing code", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: "https://exercism.org/tracks/python/exercises/pov/edit" },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    let submittedTabId = null;
    context.chrome.tabs.get = async () => ({
        id: 10,
        url: "https://exercism.org/tracks/python/exercises/pov/edit"
    });
    vm.runInContext(
        "ExercismAdapter.testAndSubmit = async tabId => { submittedTabId = tabId; }",
        context
    );
    context.submittedTabId = null;
    context.chrome.scripting.executeScript = async ({ func }) => [{
        result: func.toString().includes("navigator.clipboard")
            ? "def fixed_code():\n    return True"
            : true
    }];
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Exercism' } }",
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1 })",
        context
    );

    submittedTabId = context.submittedTabId;
    assert.equal(submittedTabId, 10);
});

test("waits for Exercism editor state to reflect replaced code before running tests", async () => {
    const context = loadCoreWorker();
    context.pageActions = [];
    vm.runInContext(`
        let stateReads = 0;
        sleep = async () => {};
        executePage = async (_tabId, pageFunction) => {
            const source = pageFunction.toString();

            if (source.includes("const runTests =")) {
                const states = [
                    {
                        editor: true,
                        runTestsDisabled: true,
                        submitDisabled: true,
                        running: false,
                        failed: false
                    },
                    {
                        editor: true,
                        runTestsDisabled: false,
                        submitDisabled: true,
                        running: false,
                        failed: false
                    },
                    {
                        editor: true,
                        runTestsDisabled: false,
                        submitDisabled: false,
                        running: false,
                        failed: false
                    }
                ];
                return states[Math.min(stateReads++, states.length - 1)];
            }

            if (source.includes("continue without waiting")) {
                return { dismissed: true, leftEditor: false };
            }

            if (source.includes(".run-tests-btn button")) {
                pageActions.push("run-tests");
                return true;
            }

            if (source.includes(".submit-btn button")) {
                pageActions.push("submit");
                return { ok: true };
            }

            return true;
        };
    `, context);

    await vm.runInContext("ExercismAdapter.testAndSubmit(10)", context);

    assert.deepEqual(context.pageActions, ["run-tests", "submit"]);
});

test("deduplicates Exercism test-and-submit requests per tab", async () => {
    const context = loadCoreWorker();
    context.chrome.tabs.get = async () => ({
        id: 10,
        url: "https://exercism.org/tracks/python/exercises/pov/edit"
    });
    context.submissionCalls = 0;
    vm.runInContext(
        "ExercismAdapter.testAndSubmit = async () => { submissionCalls += 1; await new Promise(resolve => setTimeout(resolve, 10)); }",
        context
    );

    await Promise.all([
        vm.runInContext("runExercismTestSubmit(10)", context),
        vm.runInContext("runExercismTestSubmit(10)", context)
    ]);

    assert.equal(context.submissionCalls, 1);
});
