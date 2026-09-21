/*
 * Unit tests for platform routing, prompt assembly, and extension commands.
 * Website-specific selectors belong in tests/browser-smoke.test.js.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");

function loadWorker() {
    const listeners = {};
    const chrome = {
        action: { onClicked: { addListener: listener => { listeners.clicked = listener; } } },
        commands: { onCommand: { addListener: listener => { listeners.command = listener; } } },
        runtime: { onMessage: { addListener: listener => { listeners.message = listener; } } },
        scripting: {
            executeScript: async () => [{ result: true }]
        },
        tabs: {
            query: async () => [],
            update: async () => {}
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

    const source = fs.readFileSync(
        path.join(ROOT_DIR, "background.js"),
        "utf8"
    );
    vm.runInContext(source, context);
    return { context, listeners };
}

test("selects the Exercism adapter for exercise edit pages", () => {
    const { context } = loadWorker();
    const name = vm.runInContext(
        "getPlatform('https://exercism.org/tracks/c/exercises/hello-world/edit').name",
        context
    );
    assert.equal(name, "Exercism");
});

test("selects the Exercism overview adapter without matching the editor page", () => {
    const { context } = loadWorker();
    const result = vm.runInContext(
        "({ overview: getPlatform('https://exercism.org/tracks/c/exercises/protein-translation').name, editor: getPlatform('https://exercism.org/tracks/c/exercises/protein-translation/edit').name })",
        context
    );

    assert.equal(result.overview, "Exercism overview");
    assert.equal(result.editor, "Exercism");
});

test("selects the LeetCode adapter for problem pages", () => {
    const { context } = loadWorker();
    const name = vm.runInContext(
        "getPlatform('https://leetcode.com/problems/two-sum/').name",
        context
    );
    assert.equal(name, "LeetCode");
});

test("selects the Codewars adapter for kata pages", () => {
    const { context } = loadWorker();
    const result = vm.runInContext(
        "({ base: getPlatform('https://www.codewars.com/kata/55c45be3b2079ecccb00010b').name, training: getPlatform('https://www.codewars.com/kata/55c45be3b2079ecccb00010b/train/javascript').name, bare: getPlatform('https://codewars.com/kata/55c45be3b2079ecccb00010b').name })",
        context
    );

    assert.equal(result.base, "Codewars");
    assert.equal(result.training, "Codewars");
    assert.equal(result.bare, "Codewars");
});

test("does not treat unrelated Codewars pages as kata pages", () => {
    const { context } = loadWorker();
    assert.throws(
        () => vm.runInContext("getPlatform('https://www.codewars.com/users/example')", context),
        /not a supported coding exercise page/
    );
});

test("recognizes DeepAI pages with common URL variants", () => {
    const { context } = loadWorker();
    const result = vm.runInContext(
        "LLM_PROVIDERS.find(provider => provider.name === 'DeepAI').match('https://www.deepai.org/chat') && LLM_PROVIDERS.find(provider => provider.name === 'DeepAI').match('https://deepai.org/')",
        context
    );
    assert.equal(result, true);
});

test("does not treat malformed or unrelated URLs as LLM pages", () => {
    const { context } = loadWorker();
    const result = vm.runInContext(
        "LLM_PROVIDERS.some(provider => provider.match('https://deepai.org.evil.example/')) || LLM_PROVIDERS.some(provider => provider.match('not a URL'))",
        context
    );
    assert.equal(result, false);
});

test("rejects unsupported pages", () => {
    const { context } = loadWorker();
    assert.throws(
        () => vm.runInContext("getPlatform('https://example.com/')", context),
        /not a supported coding exercise page/
    );
});

test("rejects view-source pages", () => {
    const { context } = loadWorker();
    assert.throws(
        () => vm.runInContext(
            "getPlatform('view-source:https://exercism.org/tracks/c/exercises/hello-world/edit')",
            context
        ),
        /Open the normal Exercism page instead of view-source/
    );
});

test("registers the manifest command name", () => {
    const { listeners } = loadWorker();
    assert.equal(typeof listeners.command, "function");
});

test("uses a content script for the Exercism Ctrl+Enter shortcut", () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(ROOT_DIR, "manifest.json"),
        "utf8"
    ));
    assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
    assert.equal(manifest.commands["exercism-test-submit"], undefined);
});

test("intercepts Exercism Ctrl+Enter before editor newline handling", () => {
    const source = fs.readFileSync(
        path.join(ROOT_DIR, "content.js"),
        "utf8"
    );

    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /event\.stopImmediatePropagation\(\)/);
    assert.match(source, /\}, true\);/);
});

test("supports the optional Exercism mark-complete confirmation chain", () => {
    const source = fs.readFileSync(
        path.join(
            ROOT_DIR,
            "worker",
            "extract_coding_site_context_with_site_adapters.js"
        ),
        "utf8"
    );

    assert.match(source, /mark as complete/i);
    assert.match(source, /confirm\|complete/i);
    assert.match(source, /completeExercismExercise\(tabId\)/);
});

test("registers the extension icon", () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(ROOT_DIR, "manifest.json"),
        "utf8"
    ));
    assert.equal(manifest.icons["128"], "icons/icon128.png");
    assert.deepEqual(manifest.action.default_icon, {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
    });
    for (const iconPath of Object.values(manifest.action.default_icon)) {
        assert.equal(fs.existsSync(
            path.join(ROOT_DIR, iconPath)
        ), true);
    }
});

test("builds a prompt with LeetCode context and source", () => {
    const { context } = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', title: 'Memoize II', description: 'Use === identity.', source: 'function memoize(fn) {}' })",
        context
    );

    assert.match(prompt, /Memoize II/);
    assert.match(prompt, /Use === identity\./);
    assert.match(prompt, /function memoize\(fn\) \{\}/);
    assert.doesNotMatch(prompt, /你是我的编程助手/);
    assert.doesNotMatch(prompt, /题目描述：|当前代码：|```javascript/);
    assert.doesNotMatch(prompt, /最近一次运行\/提交反馈/);
});

test("does not transport LeetCode editorial guidance", () => {
    const { context } = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', description: 'Write a function createHelloWorld.\\nQuestions you should ask yourself and get answer to in the editorial section.\\nCan you solve this real interview question?\\nExample 1: Input: args = []' })",
        context
    );

    assert.equal(prompt, "Write a function createHelloWorld.");
    assert.doesNotMatch(prompt, /Questions you should ask yourself/);
    assert.doesNotMatch(prompt, /Can you solve this real interview question/);
});

test("does not transport LeetCode performance rankings", () => {
    const { context } = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', description: 'Given a function fn, return a new function.', feedback: 'Accepted\\nBeats 99.56% of js users with 36 ms runtime' })",
        context
    );

    assert.match(prompt, /Accepted/);
    assert.doesNotMatch(prompt, /Beats 99\.56%/);
    assert.doesNotMatch(prompt, /36 ms runtime/);
});

test("removes performance ranking prepended to LeetCode description", () => {
    const { context } = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', description: 'Beats 99.56% ❇️ of js users with 36 ms runtime 😁\\n\\nGiven a function fn, return a new function.' })",
        context
    );

    assert.equal(prompt, "Given a function fn, return a new function.");
});

test("adds submission feedback to the prompt when available", () => {
    const { context } = loadWorker();
    const prompt = vm.runInContext(
        "buildPrompt({ platform: 'LeetCode', source: 'const answer = 1;', feedback: 'Wrong Answer\\nExpected: 2\\nOutput: 1' })",
        context
    );

    assert.match(prompt, /Expected: 2/);
    assert.doesNotMatch(prompt, /最近一次运行\/提交反馈/);
});

