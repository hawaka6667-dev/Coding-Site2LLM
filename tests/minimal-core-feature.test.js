/* @machine
file: tests/minimal-core-feature.test.js
role: verify prompt assembly and context normalization
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");

function loadWorker() {
    const tabState = [];
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} } },
        scripting: { executeScript: async () => [{ result: true }] },
        tabs: {
            query: async details => details?.windowId
                ? tabState.filter(tab => tab.windowId === details.windowId)
                : tabState,
            update: async () => {},
            get: async () => ({})
        }
    };
    const context = vm.createContext({
        chrome,
        console,
        performance,
        setTimeout,
        clearTimeout
    });

    context.importScripts = (...files) => {
        for (const file of files) {
            const source = fs.readFileSync(path.join(ROOT_DIR, file), "utf8");
            vm.runInContext(source, context, { filename: file });
        }
    };
    context.tabState = tabState;

    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    return context;
}

function loadKeyboardShortcuts() {
    const listeners = [];
    const context = vm.createContext({
        chrome: { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage: () => {} } },
        document: { addEventListener: (type, listener) => listeners.push({ type, listener }) },
        location: { hostname: "example.com" }
    });
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "worker", "keyboard_shortcuts.js"), "utf8"),
        context
    );
    return { context, listeners };
}

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
});

test("assembles title, description, feedback, and source", () => {
    const context = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'Codewars', title: 'Closest pair', description: 'Find the closest points.', feedback: 'Failed: 2', source: 'def closest(points): pass' })",
        context
    );

    assert.match(prompt, /Closest pair/);
    assert.match(prompt, /Find the closest points\./);
    assert.match(prompt, /Failed: 2/);
    assert.match(prompt, /def closest\(points\): pass/);
});

test("diagnoses context field presence and lengths without exposing values", () => {
    const context = loadWorker();
    const diagnostics = vm.runInContext(
        "diagnoseContext({ platform: 'Codewars', title: 'Closest pair', source: 'x = 1' })",
        context
    );

    assert.equal(JSON.stringify(diagnostics), JSON.stringify({
        platform: "Codewars",
        fields: {
            title: { present: true, length: 12 },
            description: { present: false, length: 0 },
            source: { present: true, length: 5 },
            language: { present: false, length: 0 },
            feedback: { present: false, length: 0 }
        }
    }));
});

test("parses useful Codewars test result feedback", () => {
    const context = loadWorker();
    const feedback = vm.runInContext(
        "parseCodewarsFeedback('Test Results\\nPassed: 0\\nFailed: 78\\nExpected: 2\\nActual: 1')",
        context
    );

    assert.match(feedback, /Test Results/);
    assert.match(feedback, /Failed: 78/);
    assert.match(feedback, /Actual: 1/);
});

test("parses useful Exercism result feedback", () => {
    const context = loadWorker();
    const feedback = vm.runInContext(
        "parseExercismFeedback('4 TEST FAILURES\\n11 tests passed\\n4 tests failed\\nFAILED\\nTest 7\\nExpected: 2\\nActual: 1')",
        context
    );

    assert.match(feedback, /4 TEST FAILURES/);
    assert.match(feedback, /Expected: 2/);
    assert.match(feedback, /Actual: 1/);
});

test("keeps all three Exercism feedback panels in order", () => {
    const context = loadWorker();
    const feedback = vm.runInContext(
        "parseExercismFeedback('Instructions\\nReport network IO statistics.\\n\\nTests\\nExpected: 2\\nActual: 1\\n\\nResults\\n1 TEST FAILURE')",
        context
    );

    assert.match(feedback, /Instructions/);
    assert.match(feedback, /Tests/);
    assert.match(feedback, /Results/);
});

test("removes LeetCode editorial and performance noise", () => {
    const context = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', description: 'Beats 99.56% of js users with 36 ms runtime\\n\\nGiven a function fn, return a new function.\\nQuestions you should ask yourself and get answer to in the editorial section.' })",
        context
    );

    assert.equal(prompt, "Given a function fn, return a new function.");
});

test("preserves useful submission feedback while removing rankings", () => {
    const context = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', source: 'const answer = 1;', feedback: 'Wrong Answer\\nExpected: 2\\nBeats 99% of users' })",
        context
    );

    assert.match(prompt, /Expected: 2/);
    assert.doesNotMatch(prompt, /Beats 99%/);
});

test("returns without replacing code when no LLM copy happened", async () => {
    const context = loadWorker();
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
    const context = loadWorker();
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
    const context = loadWorker();
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

test("returns and replaces likely code when the LLM copy button emits no copy event", async () => {
    const context = loadWorker();
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

test("uses the Exercism test-and-submit adapter after replacing code", async () => {
    const context = loadWorker();
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

test("deduplicates Exercism test-and-submit requests per tab", async () => {
    const context = loadWorker();
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
