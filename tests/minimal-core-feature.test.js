/*
 * Minimal feature tests for prompt assembly and context normalization.
 * Use this suite for the smallest feedback loop during feature development.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");

function loadWorker() {
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} } },
        scripting: { executeScript: async () => [{ result: true }] },
        tabs: { query: async () => [], update: async () => {} }
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

    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    return context;
}

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
