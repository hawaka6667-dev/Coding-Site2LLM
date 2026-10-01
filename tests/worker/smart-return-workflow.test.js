/* @machine
file: tests/worker/smart-return-workflow.test.js
role: verify Smart Return copy, return, and code-write lifecycle
run: npm run test:unit
建议：可以多加几个，不止两个
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadCoreWorker } = require("../worker-test-harness.js");

test("returns without replacing code when no LLM copy happened", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: "https://exercism.org/tracks/python/exercises/pov/edit" },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    const updates = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    context.chrome.scripting.executeScript = async ({ func }) => [{
        result: func.toString().includes("navigator.clipboard") ? "" : true
    }];
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Exercism' } }",
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1 })",
        context
    );

    assert.equal(
        JSON.stringify(updates),
        JSON.stringify([[10, { active: true }]])
    );
});

test("persists the default Alt+Q return route in durable extension storage", async () => {
    const context = loadCoreWorker();
    context.tabState.push({
        id: 20,
        windowId: 1,
        index: 1,
        active: true,
        url: "https://chat.deepseek.com/"
    });
    const stored = {};
    context.chrome.storage = {
        local: {
            set: async value => Object.assign(stored, value),
            get: async key => Array.isArray(key)
                ? Object.fromEntries(key.map(name => [name, stored[name]]))
                : { [key]: stored[key] }
        },
        session: {
            set: async () => {},
            get: async () => ({})
        }
    };
    await vm.runInContext(
        "saveReturnRoute({ windowId: 1, sourceTabId: 10, llmTabId: 20 })",
        context
    );
    context.returnRoutes = null;

    const route = await vm.runInContext("loadReturnRoute()", context);

    assert.equal(route.windowId, 1);
    assert.equal(route.sourceTabId, 10);
    assert.equal(route.llmTabId, 20);
});

test("returns and replaces code after an LLM copy event", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: "https://exercism.org/tracks/python/exercises/pov/edit" },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    const updates = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    context.chrome.scripting.executeScript = async ({ func }) => [{
        result: func.toString().includes("navigator.clipboard") ? "fixed code" : true
    }];
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Exercism', copied: true, copiedText: 'fixed code' } }",
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1 })",
        context
    );

    assert.equal(
        JSON.stringify(updates),
        JSON.stringify([[10, { active: true }]])
    );
});

test("returns to the exact generic HTTP source page", async () => {
    const context = loadCoreWorker();
    const sourceUrl = "https://example.com/task?case=1";
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: sourceUrl },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    const updates = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    context.readClipboard = async () => "";
    vm.runInContext(
        `returnRoutes = { "1:20": { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: "Web source", sourceUrl: ${JSON.stringify(sourceUrl)}, sourceIdentity: ${JSON.stringify(sourceUrl)} } }`,
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1 })",
        context
    );

    assert.deepEqual(updates.map(([tabId]) => tabId), [10]);
    assert.equal(
        vm.runInContext("returnRoutes['1:20'].status", context),
        "routed"
    );
});

test("uses only an exact generic HTTP URL as a fallback", async () => {
    const context = loadCoreWorker();
    const sourceUrl = "https://example.com/task?case=1";
    context.tabState.push(
        { id: 20, windowId: 1, index: 0, url: "https://chat.deepseek.com/" },
        { id: 30, windowId: 1, index: 1, url: "https://example.com/task?case=2" },
        { id: 40, windowId: 1, index: 2, url: sourceUrl }
    );
    const updates = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    context.readClipboard = async () => "";
    vm.runInContext(
        `returnRoutes = { "1:20": { windowId: 1, sourceTabId: null, llmTabId: 20, sourcePlatform: "Web source", sourceUrl: ${JSON.stringify(sourceUrl)}, sourceIdentity: ${JSON.stringify(sourceUrl)}, status: "orphaned" } }`,
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1, index: 0 })",
        context
    );

    assert.deepEqual(updates.map(([tabId]) => tabId), [40]);
    assert.equal(vm.runInContext("returnRoutes['1:20'].sourceTabId", context), 40);
});

test("does not use a different generic HTTP URL as a fallback", async () => {
    const context = loadCoreWorker();
    const sourceUrl = "https://example.com/task?case=1";
    context.tabState.push(
        { id: 20, windowId: 1, index: 0, url: "https://chat.deepseek.com/" },
        { id: 30, windowId: 1, index: 1, url: "https://example.com/task?case=2" }
    );
    const updates = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    context.readClipboard = async () => "";
    vm.runInContext(
        `returnRoutes = { "1:20": { windowId: 1, sourceTabId: null, llmTabId: 20, sourcePlatform: "Web source", sourceUrl: ${JSON.stringify(sourceUrl)}, sourceIdentity: ${JSON.stringify(sourceUrl)}, status: "orphaned" } }`,
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1, index: 0 })",
        context
    );

    assert.deepEqual(updates, []);
    assert.equal(vm.runInContext("returnRoutes['1:20'].sourceTabId", context), null);
    assert.equal(vm.runInContext("returnRoutes['1:20'].status", context), "orphaned");
});

test("does not overlap Smart Return cycles for the same LLM tab", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: "https://exercism.org/tracks/python/exercises/pov/edit" },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    let releaseClipboard;
    let submitCount = 0;
    context.readClipboard = () => new Promise(resolve => {
        releaseClipboard = resolve;
    });
    context.chrome.tabs.update = async () => {};
    context.replaceCode = async () => {};
    context.submitReturnedCode = async () => { submitCount += 1; };
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Exercism', sourceUrl: 'https://exercism.org/tracks/python/exercises/pov/edit', sourceIdentity: 'Exercism:python:pov', copied: true, copiedText: 'fixed code' } }",
        context
    );

    const firstRun = vm.runInContext(
        "runSmartReturn({ id: 20, windowId: 1 })",
        context
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof releaseClipboard, "function");

    await vm.runInContext(
        "runSmartReturn({ id: 20, windowId: 1 })",
        context
    );
    releaseClipboard("");
    await firstRun;

    assert.equal(submitCount, 1);
});

test("preserves a newer return route when an earlier Smart Return finishes", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 1, url: "https://example.com/first" },
        { id: 11, windowId: 1, index: 2, url: "https://example.com/second" },
        { id: 20, windowId: 1, index: 0, url: "https://chat.deepseek.com/" }
    );
    context.readClipboard = async () => "";
    context.chrome.tabs.update = async () => {};
    context.replaceCode = async () => {};
    let finishFirstSubmit;
    context.submitReturnedCode = () => new Promise(resolve => {
        finishFirstSubmit = resolve;
    });
    vm.runInContext(`returnRoutes = { "1:20": {
        windowId: 1, sourceTabId: 10, llmTabId: 20,
        sourcePlatform: "Web source", sourceUrl: "https://example.com/first",
        sourceIdentity: "https://example.com/first", copied: true, copiedText: "first code"
    } }`, context);

    const firstRun = vm.runInContext(
        "runSmartReturn({ id: 20, windowId: 1 })",
        context
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finishFirstSubmit, "function");

    await vm.runInContext(`saveReturnRoute({
        windowId: 1, sourceTabId: 11, llmTabId: 20,
        sourcePlatform: "Web source", sourceUrl: "https://example.com/second",
        sourceIdentity: "https://example.com/second",
        copied: true, copiedText: "second code", status: "routed"
    })`, context);

    finishFirstSubmit();
    await firstRun;

    const route = vm.runInContext("returnRoutes['1:20']", context);
    assert.equal(route.sourceTabId, 11);
    assert.equal(route.sourceUrl, "https://example.com/second");
    assert.equal(route.copied, true);
    assert.equal(route.copiedText, "second code");
});

test("does not orphan a newer route when an earlier return finds no target", async () => {
    const context = loadCoreWorker();
    context.tabState.push({
        id: 20,
        windowId: 1,
        index: 0,
        url: "https://chat.deepseek.com/"
    });
    let finishTabQuery;
    context.chrome.tabs.query = () => new Promise(resolve => {
        finishTabQuery = resolve;
    });
    vm.runInContext(`returnRoutes = { "1:20": {
        windowId: 1, sourceTabId: 10, llmTabId: 20,
        sourcePlatform: "Web source", sourceUrl: "https://example.com/first",
        sourceIdentity: "https://example.com/first", copied: true, copiedText: "first code"
    } }`, context);

    const firstRun = vm.runInContext(
        "runSmartReturn({ id: 20, windowId: 1 })",
        context
    );
    await new Promise(resolve => setImmediate(resolve));

    await vm.runInContext(`saveReturnRoute({
        windowId: 1, sourceTabId: 11, llmTabId: 20,
        sourcePlatform: "Web source", sourceUrl: "https://example.com/second",
        sourceIdentity: "https://example.com/second",
        copied: true, copiedText: "second code", status: "routed"
    })`, context);

    finishTabQuery([{
        id: 20,
        windowId: 1,
        index: 0,
        url: "https://chat.deepseek.com/"
    }]);
    await firstRun;

    const route = vm.runInContext("returnRoutes['1:20']", context);
    assert.equal(route.sourceTabId, 11);
    assert.equal(route.sourceUrl, "https://example.com/second");
    assert.equal(route.copied, true);
    assert.equal(route.copiedText, "second code");
});

test("does not overwrite a route replaced while Smart Return selects its target", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 1, url: "https://example.com/first" },
        { id: 11, windowId: 1, index: 2, url: "https://example.com/second" },
        { id: 20, windowId: 1, index: 0, url: "https://chat.deepseek.com/" }
    );
    context.readClipboard = async () => "";
    const updates = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    let finishTabQuery;
    context.chrome.tabs.query = () => new Promise(resolve => {
        finishTabQuery = () => resolve(context.tabState);
    });
    vm.runInContext(`returnRoutes = { "1:20": {
        windowId: 1, sourceTabId: 10, llmTabId: 20,
        sourcePlatform: "Web source", sourceUrl: "https://example.com/first",
        sourceIdentity: "https://example.com/first", copied: true, copiedText: "first code"
    } }`, context);
    await vm.runInContext(`saveReturnRoute(returnRoutes["1:20"])`, context);

    const firstRun = vm.runInContext(
        "runSmartReturn({ id: 20, windowId: 1 })",
        context
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finishTabQuery, "function");

    await vm.runInContext(`saveReturnRoute({
        ...returnRoutes["1:20"], sourceTabId: 11,
        sourceUrl: "https://example.com/second",
        sourceIdentity: "https://example.com/second",
        copied: true, copiedText: "second code"
    })`, context);
    finishTabQuery();
    await firstRun;

    const route = vm.runInContext("returnRoutes['1:20']", context);
    assert.equal(route.sourceTabId, 11);
    assert.equal(route.sourceUrl, "https://example.com/second");
    assert.equal(route.copiedText, "second code");
    assert.deepEqual(updates, []);
});

test("runs sequential Smart Return cycles with a fresh route and payload", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 1, url: "https://example.com/first" },
        { id: 11, windowId: 1, index: 2, url: "https://example.com/second" },
        { id: 20, windowId: 1, index: 0, url: "https://chat.deepseek.com/" }
    );
    const writes = [];
    context.readClipboard = async () => "";
    context.chrome.tabs.update = async () => {};
    context.replaceCode = async (tabId, text) => writes.push([tabId, text]);
    context.submitReturnedCode = async () => {};
    vm.runInContext(`returnRoutes = { "1:20": {
        windowId: 1, sourceTabId: 10, llmTabId: 20,
        sourcePlatform: "Web source", sourceUrl: "https://example.com/first",
        sourceIdentity: "https://example.com/first", copied: true, copiedText: "first code"
    } }`, context);

    await vm.runInContext("runSmartReturn({ id: 20, windowId: 1 })", context);
    await vm.runInContext(`saveReturnRoute({
        ...returnRoutes["1:20"], sourceTabId: 11,
        sourceUrl: "https://example.com/second",
        sourceIdentity: "https://example.com/second",
        copied: true, copiedText: "second code"
    })`, context);
    await vm.runInContext("runSmartReturn({ id: 20, windowId: 1 })", context);

    assert.deepEqual(writes, [[10, "first code"], [11, "second code"]]);
    assert.equal(vm.runInContext("returnRoutes['1:20'].copied", context), false);
});

test("clears consumed LLM copy when Smart Return submission fails", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: "https://exercism.org/tracks/python/exercises/pov/edit" },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    context.chrome.tabs.update = async () => {};
    context.chrome.scripting.executeScript = async ({ func }) => {
        const source = func.toString();

        if (source.includes("navigator.clipboard")) {
            return [{ result: "fixed code" }];
        }

        if (source.includes("KeyboardEvent")) {
            throw new Error("submission failed");
        }

        return [{ result: true }];
    };
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Exercism', copied: true, copiedText: 'fixed code' } }",
        context
    );

    await assert.rejects(
        vm.runInContext("returnToCodingPage({ id: 20, windowId: 1 })", context),
        /submission failed/
    );

    assert.equal(vm.runInContext("returnRoutes['1:20'].copied", context), false);
    assert.equal(vm.runInContext("returnRoutes['1:20'].copiedText", context), "");
});

test("returns and replaces likely code when the LLM copy button emits no copy event", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        { id: 10, windowId: 1, index: 0, url: "https://exercism.org/tracks/python/exercises/pov/edit" },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    const updates = [];
    const executed = [];
    context.chrome.tabs.update = async (...args) => updates.push(args);
    context.chrome.scripting.executeScript = async ({ func }) => {
        executed.push(func.toString());
        return [{
            result: func.toString().includes("navigator.clipboard")
                ? "const fixedCode = true;"
                : true
        }];
    };
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Exercism' } }",
        context
    );

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1 })",
        context
    );

    assert.equal(
        JSON.stringify(updates),
        JSON.stringify([[10, { active: true }]])
    );
    assert.equal(executed.length, 3);
});

test("Smart Return writes to the Codewars solution editor and attempts the full suite", async () => {
    const context = loadCoreWorker();
    const solution = {
        value: "starter code",
        setValue(value) { this.value = value; },
        getValue() { return this.value; },
        focus() { this.focused = true; }
    };
    let attemptCount = 0;
    const attemptButton = {
        offsetWidth: 80,
        offsetHeight: 30,
        click() { attemptCount += 1; }
    };
    context.document = {
        querySelector(selector) {
            if (selector === "#code .js-editor .CodeMirror") {
                return { CodeMirror: solution };
            }
            if (selector === "#attempt_btn") {
                return attemptButton;
            }
            return null;
        }
    };
    context.executePage = async (_tabId, pageFunction, args = []) =>
        pageFunction(...args);
    context.readClipboard = async () => "public class XO { /* fixed */ }";
    context.chrome.tabs.get = async () => ({
        id: 10,
        url: "https://www.codewars.com/kata/55908aad6620c066bc00002a/train/java"
    });
    context.chrome.tabs.update = async () => {};
    context.tabState.push(
        {
            id: 10,
            windowId: 1,
            index: 0,
            url: "https://www.codewars.com/kata/55908aad6620c066bc00002a/train/java"
        },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" }
    );
    vm.runInContext(
        "returnRoutes = { '1:20': { windowId: 1, sourceTabId: 10, llmTabId: 20, sourcePlatform: 'Codewars', copied: true, copiedText: 'public class XO { /* fixed */ }' } }",
        context
    );

    await vm.runInContext("returnToCodingPage({ id: 20, windowId: 1 })", context);

    assert.equal(solution.value, "public class XO { /* fixed */ }");
    assert.equal(solution.focused, true);
    assert.equal(attemptCount, 1);
    assert.equal(vm.runInContext("returnRoutes['1:20'].copied", context), false);
});
