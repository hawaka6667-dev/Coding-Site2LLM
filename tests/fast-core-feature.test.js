/* @machine
file: tests/coding-to-llm-workflow.test.js
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
    const messageListeners = [];
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: listener => messageListeners.push(listener) } },
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
    context.messageListeners = messageListeners;

    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    return context;
}

function loadKeyboardShortcuts(hostname = "example.com", savedShortcuts = {}, selectedText = "") {
    const listeners = [];
    const messages = [];
    const context = vm.createContext({
        chrome: {
            storage: { local: { get: async () => ({ codingSite2LlmShortcuts: savedShortcuts }) } },
            runtime: { sendMessage: message => messages.push(message) }
        },
        document: { addEventListener: (type, listener) => listeners.push({ type, listener }) },
        window: { getSelection: () => ({ toString: () => selectedText }) },
        location: { hostname }
    });
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "worker", "keyboard_shortcuts.js"), "utf8"),
        context
    );
    return { context, listeners, messages };
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

test("sends selected text instead of page context and keeps full context as the default", async () => {
    const context = loadWorker();
    context.tabState.push({
        id: 10,
        windowId: 1,
        index: 0,
        active: true,
        url: "https://leetcode.com/problems/two-sum/"
    });
    context.tabState.push({
        id: 20,
        windowId: 1,
        index: 1,
        url: "https://chat.deepseek.com/"
    });
    context.chrome.storage = {
        local: { get: async () => ({ selectedLlmProvider: "DeepSeek" }) }
    };
    context.insertedPrompts = [];
    context.contextReads = 0;
    context.findLlmTab = async () => ({ tab: { id: 20 }, provider: { name: "DeepSeek" } });
    context.waitForDeepSeekInput = async () => {};
    context.insertText = async (_tabId, prompt) => context.insertedPrompts.push(prompt);
    context.keyTap = async () => {};
    context.scrollUp = async () => {};
    context.saveReturnRoute = async () => {};
    vm.runInContext(`LeetCodeAdapter.getContext = async () => {
        contextReads += 1;
        return {
            platform: "LeetCode",
            title: "Two Sum",
            description: "Find two numbers.",
            source: "const answer = 1;"
        };
    }`, context);

    await vm.runInContext("runWorkflow('  selected code  ')", context);
    await vm.runInContext("runWorkflow()", context);

    assert.deepEqual(context.insertedPrompts, [
        "  selected code  ",
        "Two Sum\n\nFind two numbers.\n\nconst answer = 1;"
    ]);
    assert.equal(context.contextReads, 1);
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

test("filters HTML markup from generic web fallback text", async () => {
    const context = loadWorker();
    context.chrome.scripting.executeScript = async ({ func, args = [] }) => [{
        result: await func(...args)
    }];
    const removedTags = [];
    const html = "<html><body><p>Problem text</p><script>secret()</script></body></html>";
    context.document = { title: "Example problem" };
    context.location = { href: "https://example.com/problem" };
    context.fetch = async () => ({
        headers: { get: () => "text/html; charset=utf-8" },
        text: async () => html
    });
    context.DOMParser = class {
        parseFromString(markup, type) {
            assert.equal(markup, html);
            assert.equal(type, "text/html");
            return {
                body: { innerText: "Problem text", textContent: "Problem text" },
                querySelectorAll: selector => {
                    assert.equal(selector, "script, style, template, noscript, svg");
                    return [
                        { remove: () => removedTags.push("script") },
                        { remove: () => removedTags.push("style") }
                    ];
                }
            };
        }
    };

    const result = await vm.runInContext(
        "SourceFallbackAdapter.getContext(1)",
        context
    );

    assert.equal(result.source, "Problem text");
    assert.deepEqual(removedTags, ["script", "style"]);
});

test("preserves non-HTML source in generic web fallback", async () => {
    const context = loadWorker();
    context.chrome.scripting.executeScript = async ({ func, args = [] }) => [{
        result: await func(...args)
    }];
    const source = "const lessThan = left < right;";
    context.document = { title: "Plain source" };
    context.location = { href: "https://example.com/source.txt" };
    context.fetch = async () => ({
        headers: { get: () => "text/plain; charset=utf-8" },
        text: async () => source
    });
    context.DOMParser = class {
        constructor() {
            throw new Error("DOMParser should not be used for plain source");
        }
    };

    const result = await vm.runInContext(
        "SourceFallbackAdapter.getContext(1)",
        context
    );

    assert.equal(result.source, source);
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

test("clears consumed LLM copy when Smart Return submission fails", async () => {
    const context = loadWorker();
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

test("waits for Exercism editor state to reflect replaced code before running tests", async () => {
    const context = loadWorker();
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

test("routes Ctrl+Enter submission to the Exercism tab that sent the message", async () => {
    const context = loadWorker();
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

test("returns to the same Exercism editor when Submit navigates to its overview", () => {
    const listeners = [];
    const replacements = [];
    const messages = [];
    const backToExerciseLink = {
        innerText: "Back to Exercise",
        href: "https://exercism.org/tracks/python/exercises/pov?from=editor",
        offsetWidth: 100,
        offsetHeight: 20,
        getAttribute: () => null
    };
    const document = {
        addEventListener: (type, listener, capture) =>
            listeners.push({ type, listener, capture }),
        querySelectorAll: () => [backToExerciseLink]
    };
    let now = 1000;
    const context = vm.createContext({
        URL,
        Date: { now: () => now },
        document,
        chrome: { runtime: { sendMessage: message => messages.push(message) } },
        location: {
            href: "https://exercism.org/tracks/python/exercises/pov/edit",
            replace: url => replacements.push(url)
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(
                ROOT_DIR,
                "worker",
                "exercism",
                "edit",
                "return_to_editor_after_submit_redirect.js"
            ),
            "utf8"
        ),
        context
    );

    const submitClickListener = listeners.find(listener => listener.type === "click");
    const beforeVisitListener = listeners.find(
        listener => listener.type === "turbo:before-visit"
    );
    const submitButton = { disabled: false };
    const clickEvent = {
        target: { closest: selector =>
            selector === ".lhs-footer .submit-btn button" ? submitButton : null
        }
    };
    submitClickListener.listener(clickEvent);

    const overviewVisit = {
        detail: {
            url: "https://exercism.org/tracks/python/exercises/pov"
        },
        prevented: false,
        preventDefault() {
            this.prevented = true;
        }
    };
    beforeVisitListener.listener(overviewVisit);

    assert.equal(overviewVisit.prevented, true);
    assert.deepEqual(replacements, [
        "https://exercism.org/tracks/python/exercises/pov/edit"
    ]);
    assert.equal(JSON.stringify(messages), JSON.stringify([{
        type: "exercism-open-submitted-overview",
        overviewUrl: "https://exercism.org/tracks/python/exercises/pov?from=editor"
    }]));

    const nextOverviewVisit = {
        detail: {
            url: "https://exercism.org/tracks/python/exercises/pov"
        },
        prevented: false,
        preventDefault() {
            this.prevented = true;
        }
    };
    beforeVisitListener.listener(nextOverviewVisit);
    assert.equal(nextOverviewVisit.prevented, false);
    assert.equal(replacements.length, 1);
    assert.equal(messages.length, 1);

    submitClickListener.listener(clickEvent);
    now += 1;
    const loadedOverviewListener = listeners.find(
        listener => listener.type === "turbo:load"
    );
    context.location.href = "https://exercism.org/tracks/python/exercises/other";
    loadedOverviewListener.listener();
    assert.equal(replacements.length, 1);

    context.location.href = "https://exercism.org/tracks/python/exercises/pov/edit";
    submitClickListener.listener(clickEvent);
    context.location.href = "https://exercism.org/tracks/python/exercises/pov";
    loadedOverviewListener.listener();

    assert.deepEqual(replacements, [
        "https://exercism.org/tracks/python/exercises/pov/edit",
        "https://exercism.org/tracks/python/exercises/pov/edit"
    ]);
    assert.equal(messages.length, 2);
});

test("transitions Exercism edit page from Continue dialogs to no dialog state", () => {
    const mutationCallbacks = [];
        let observerOptions;

    class Element {
        constructor(tagName, innerText = "", options = {}) {
            this.tagName = tagName;
            this.innerText = innerText;
            this.disabled = options.disabled || false;
            this.attributes = options.attributes || {};
            this.children = [];
            this.parentElement = null;
            this.clickCount = 0;
        }

        append(child) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        }

        remove() {
            if (!this.parentElement) {
                return;
            }

            this.parentElement.children = this.parentElement.children.filter(
                child => child !== this
            );
            this.parentElement = null;
            mutationCallbacks.forEach(callback => callback());
        }

        getBoundingClientRect() {
            return { width: 100, height: 30 };
        }

        getAttribute(name) {
            return this.attributes[name] || null;
        }

        click() {
            this.clickCount += 1;
            let dialog = this.parentElement;

            while (dialog && dialog.getAttribute("role") !== "dialog") {
                dialog = dialog.parentElement;
            }

            dialog?.remove();
        }

        querySelectorAll(selector) {
            const matches = [];
            const selectors = selector.split(", ");
            const visit = node => {
                for (const child of node.children) {
                    if (
                        selectors.includes(child.tagName) ||
                        (selectors.includes("[role='button']") &&
                            child.getAttribute("role") === "button") ||
                        (selectors.includes("[role='dialog']") &&
                            child.getAttribute("role") === "dialog")
                    ) {
                        matches.push(child);
                    }
                    visit(child);
                }
            };
            visit(this);
            return matches;
        }
    }

    const body = new Element("body");
    const documentElement = new Element("html");
    documentElement.append(body);
    const context = vm.createContext({
        document: {
            body,
            documentElement,
            addEventListener: () => {},
            querySelectorAll: selector => body.querySelectorAll(selector)
        },
        MutationObserver: class {
            constructor(callback) {
                mutationCallbacks.push(callback);
            }
                observe(_target, options) {
                    observerOptions = options;
                }
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "edit", "continue_after_exercism_modals.js"),
            "utf8"
        ),
        context
    );

    const addDialog = (title, buttonLabel = "Continue", buttonOptions = {}) => {
        const dialog = body.append(new Element("section", "", {
            attributes: { role: "dialog" }
        }));
        dialog.append(new Element("h2", title));
        return {
            dialog,
            button: dialog.append(new Element("button", buttonLabel, buttonOptions))
        };
    };
    const tutorial = addDialog("Dig Deeper into Reverse String!");
    const feedback = addDialog("No Immediate Feedback");
    const delayedFeedback = addDialog(
        "Automated feedback is still being generated",
        "Continue without waiting",
        { disabled: true }
    );
    const requestReview = feedback.dialog.append(
        new Element("button", "Request code review")
    );
    const disabledContinue = body.append(
        new Element("button", "Continue", { disabled: true })
    );
    const donationContinue = body.append(new Element("button", "Continue"));

    assert.equal(observerOptions.attributes, true);
    assert.deepEqual(Array.from(observerOptions.attributeFilter), ["disabled", "aria-disabled"]);
    assert.equal(body.querySelectorAll("[role='dialog']").length, 3);
    mutationCallbacks[0]();

    assert.equal(body.querySelectorAll("[role='dialog']").length, 1);
    assert.equal(tutorial.button.clickCount, 1);
    assert.equal(feedback.button.clickCount, 1);
    assert.equal(delayedFeedback.button.clickCount, 0);
    delayedFeedback.button.disabled = false;
    mutationCallbacks[0]();

    assert.equal(body.querySelectorAll("[role='dialog']").length, 0);
    assert.equal(delayedFeedback.button.clickCount, 1);
    assert.equal(requestReview.clickCount, 0);
    assert.equal(disabledContinue.clickCount, 0);
    assert.equal(donationContinue.clickCount, 0);
});
