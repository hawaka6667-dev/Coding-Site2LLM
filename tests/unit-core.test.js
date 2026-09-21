/*
 * Fast core regression tests for routing and prompt assembly.
 * Browser, manifest, and extension wiring checks run separately.
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
        scripting: { executeScript: async () => [{ result: true }] },
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

    const source = fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8");
    vm.runInContext(source, context);
    return context;
}

test("routes supported exercise pages to the expected adapters", () => {
    const context = loadWorker();
    const result = vm.runInContext(
        "({ exercism: getPlatform('https://exercism.org/tracks/c/exercises/hello-world/edit').name, leetcode: getPlatform('https://leetcode.com/problems/two-sum/').name, codewars: getPlatform('https://www.codewars.com/kata/55c45be3b2079ecccb00010b/train/javascript').name })",
        context
    );

    assert.equal(result.exercism, "Exercism");
    assert.equal(result.leetcode, "LeetCode");
    assert.equal(result.codewars, "Codewars");
});

test("routes the Exercism overview separately from its editor", () => {
    const context = loadWorker();
    const result = vm.runInContext(
        "({ overview: getPlatform('https://exercism.org/tracks/c/exercises/protein-translation').name, editor: getPlatform('https://exercism.org/tracks/c/exercises/protein-translation/edit').name })",
        context
    );

    assert.equal(result.overview, "Exercism overview");
    assert.equal(result.editor, "Exercism");
});

test("rejects unsupported, unrelated, and view-source pages", () => {
    const context = loadWorker();

    assert.throws(
        () => vm.runInContext("getPlatform('https://example.com/')", context),
        /not a supported coding exercise page/
    );
    assert.throws(
        () => vm.runInContext("getPlatform('https://www.codewars.com/users/example')", context),
        /not a supported coding exercise page/
    );
    assert.throws(
        () => vm.runInContext("getPlatform('view-source:https://exercism.org/tracks/c/exercises/hello-world/edit')", context),
        /Open the normal Exercism page instead of view-source/
    );
});

test("recognizes valid LLM provider URLs only", () => {
    const context = loadWorker();
    const result = vm.runInContext(
        "LLM_PROVIDERS.some(provider => provider.match('https://deepai.org/chat')) && !LLM_PROVIDERS.some(provider => provider.match('https://deepai.org.evil.example/'))",
        context
    );

    assert.equal(result, true);
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

test("parses Codewars test result feedback", () => {
    const context = loadWorker();
    const feedback = vm.runInContext(
        "parseCodewarsFeedback('Test Results\\nPassed: 0\\nFailed: 78\\nExpected: 2\\nActual: 1')",
        context
    );

    assert.match(feedback, /Test Results/);
    assert.match(feedback, /Passed: 0/);
    assert.match(feedback, /Failed: 78/);
    assert.match(feedback, /Expected: 2/);
    assert.match(feedback, /Actual: 1/);
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
