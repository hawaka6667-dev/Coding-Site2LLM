/* @machine
file: tests/worker/context-extraction.test.js
role: verify coding context extraction and normalization
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadCoreWorker } = require("../worker-test-harness.js");

test("assembles title, description, feedback, and source", () => {
    const context = loadCoreWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'Codewars', title: 'Closest pair', description: 'Find the closest points.', feedback: 'Failed: 2', source: 'def closest(points): pass' })",
        context
    );

    assert.match(prompt, /Closest pair/);
    assert.match(prompt, /Find the closest points\./);
    assert.match(prompt, /Failed: 2/);
    assert.match(prompt, /def closest\(points\): pass/);
});

test("extracts LeetCode source from the focused Monaco editor", async () => {
    const context = loadCoreWorker();
    const source = "bool canPlaceFlowers(int* flowerbed, int flowerbedSize, int n) { }";
    const staleSource = "bool* kidsWithCandies(int* candies, int candiesSize, int extraCandies, int* returnSize) { }";
    const activeEditorNode = { offsetWidth: 500, offsetHeight: 300 };
    const staleEditorNode = { offsetWidth: 0, offsetHeight: 0 };
    const element = text => ({
        innerText: text,
        cloneNode: () => ({ querySelectorAll: () => [], innerText: text })
    });
    const activeModel = { getValue: () => source };
    const staleModel = { getValue: () => staleSource };
    const editors = [
        { getDomNode: () => staleEditorNode, getModel: () => staleModel },
        { getDomNode: () => activeEditorNode, getModel: () => activeModel }
    ];

    context.document = {
        activeElement: {
            closest: selector => selector === ".monaco-editor" ? activeEditorNode : null
        },
        title: "Can Place Flowers - LeetCode",
        querySelector(selector) {
            if (selector === "h1") return element("Can Place Flowers");
            if (selector === '[data-track-load="description_content"]') {
                return element("Plant flowers without adjacent plots.");
            }
            return null;
        },
        querySelectorAll: () => []
    };
    context.window = {
        monaco: {
            editor: {
                getEditors: () => editors,
                getModels: () => [staleModel, activeModel]
            }
        }
    };
    context.chrome.scripting.executeScript = async ({ func }) => [{ result: await func() }];

    const result = await vm.runInContext("LeetCodeAdapter.getContext(1)", context);

    assert.equal(result.title, "Can Place Flowers");
    assert.equal(result.source, source);
    assert.doesNotMatch(result.source, /kidsWithCandies/);
});

test("extracts LeetCode submission description, verdict, failing input, and code", async () => {
    const context = loadCoreWorker();
    const source = "int findKthLargest(int* nums, int numsSize, int k) { return 0; }";
    const description = "Given an integer array nums and an integer k, return the kth largest element.";
    const feedbackPanel = {
        innerText: "All Submissions\nTime Limit Exceeded\n44 / 47 testcases passed\nsubmitted at Sep 27, 2026 21:15\nLast Executed Input\nUse Testcase\nnums = [1,2,3,4,5]\nk = 2\nView more",
        getBoundingClientRect: () => ({ width: 500, height: 300 }),
        querySelector: selector => selector === "h3"
            ? { innerText: "Time Limit Exceeded\n44 / 47 testcases passed" }
            : null
    };
    const editorNode = {
        isConnected: true,
        offsetWidth: 800,
        offsetHeight: 500,
        getBoundingClientRect: () => ({ width: 800, height: 500 })
    };
    const descriptionElement = {
        innerText: description,
        textContent: description,
        cloneNode: () => ({
            innerText: description,
            querySelectorAll: () => []
        })
    };
    let requestedUrl = "";
    let requestedCredentials = "";

    context.location = {
        href: "https://leetcode.com/problems/kth-largest-element-in-an-array/submissions/123/",
        origin: "https://leetcode.com",
        pathname: "/problems/kth-largest-element-in-an-array/submissions/123/"
    };
    context.document = {
        title: "Kth Largest Element in an Array - LeetCode",
        activeElement: null,
        querySelector: () => null,
        querySelectorAll(selector) {
            if (selector === ".flexlayout__tab") return [feedbackPanel];
            return [];
        }
    };
    context.fetch = async (url, options) => {
        requestedUrl = url;
        requestedCredentials = options.credentials;
        return { ok: true, text: async () => "<html>question page</html>" };
    };
    context.DOMParser = class {
        parseFromString() {
            return { querySelector: () => descriptionElement };
        }
    };
    context.window = {
        monaco: {
            editor: {
                getEditors: () => [{
                    getDomNode: () => editorNode,
                    getModel: () => ({ getValue: () => source })
                }]
            }
        }
    };
    context.chrome.scripting.executeScript = async ({ func }) => [{
        result: await func()
    }];

    const result = await vm.runInContext(
        "LeetCodeAdapter.getContext(1)",
        context
    );

    assert.equal(requestedUrl, "/problems/kth-largest-element-in-an-array/description/");
    assert.equal(requestedCredentials, "include");
    assert.equal(result.title, "Kth Largest Element in an Array - LeetCode");
    assert.equal(result.description, description);
    assert.match(result.feedback, /Time Limit Exceeded/);
    assert.match(result.feedback, /44 \/ 47 testcases passed/);
    assert.match(result.feedback, /nums = \[1,2,3,4,5\]/);
    assert.match(result.feedback, /k = 2/);
    assert.doesNotMatch(result.feedback, /Use Testcase|View more|All Submissions/);
    assert.equal(result.source, source);
});

test("sends selected text instead of page context and keeps full context as the default", async () => {
    const context = loadCoreWorker();
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
    const context = loadCoreWorker();
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
    const context = loadCoreWorker();
    const feedback = vm.runInContext(
        "parseCodewarsFeedback('Test Results\\nPassed: 0\\nFailed: 78\\nExpected: 2\\nActual: 1')",
        context
    );

    assert.match(feedback, /Test Results/);
    assert.match(feedback, /Failed: 78/);
    assert.match(feedback, /Actual: 1/);
});

test("parses useful Exercism result feedback", () => {
    const context = loadCoreWorker();
    const feedback = vm.runInContext(
        "parseExercismFeedback('4 TEST FAILURES\\n11 tests passed\\n4 tests failed\\nFAILED\\nTest 7\\nExpected: 2\\nActual: 1')",
        context
    );

    assert.match(feedback, /4 TEST FAILURES/);
    assert.match(feedback, /Expected: 2/);
    assert.match(feedback, /Actual: 1/);
});

test("filters HTML markup from generic web fallback text", async () => {
    const context = loadCoreWorker();
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
    const context = loadCoreWorker();
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
    const context = loadCoreWorker();
    const feedback = vm.runInContext(
        "parseExercismFeedback('Instructions\\nReport network IO statistics.\\n\\nTests\\nExpected: 2\\nActual: 1\\n\\nResults\\n1 TEST FAILURE')",
        context
    );

    assert.match(feedback, /Instructions/);
    assert.match(feedback, /Tests/);
    assert.match(feedback, /Results/);
});

test("removes LeetCode editorial and performance noise", () => {
    const context = loadCoreWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', description: 'Beats 99.56% of js users with 36 ms runtime\\n\\nGiven a function fn, return a new function.\\nQuestions you should ask yourself and get answer to in the editorial section.' })",
        context
    );

    assert.equal(prompt, "Given a function fn, return a new function.");
});

test("preserves useful submission feedback while removing rankings", () => {
    const context = loadCoreWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', source: 'const answer = 1;', feedback: 'Wrong Answer\\nExpected: 2\\nBeats 99% of users' })",
        context
    );

    assert.match(prompt, /Expected: 2/);
    assert.doesNotMatch(prompt, /Beats 99%/);
});
