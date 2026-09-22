/*
 * Local routing tests for supported coding sites and LLM providers.
 * Use this suite for a local routing change, without global maintenance checks.
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
    const context = vm.createContext({ chrome, console, performance, setTimeout });
    context.importScripts = (...files) => {
        for (const file of files) {
            vm.runInContext(
                fs.readFileSync(path.join(ROOT_DIR, file), "utf8"),
                context,
                { filename: file }
            );
        }
    };
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    return context;
}

test("routes supported exercise pages to their adapters", () => {
    const context = loadWorker();
    const result = vm.runInContext(
        "({ exercism: getPlatform('https://exercism.org/tracks/c/exercises/hello-world/edit').name, overview: getPlatform('https://exercism.org/tracks/c/exercises/hello-world').name, leetcode: getPlatform('https://leetcode.com/problems/two-sum/').name, codewars: getPlatform('https://www.codewars.com/kata/55c45be3b2079ecccb00010b/train/javascript').name })",
        context
    );

    assert.equal(JSON.stringify(result), JSON.stringify({
        exercism: "Exercism",
        overview: "Exercism overview",
        leetcode: "LeetCode",
        codewars: "Codewars"
    }));
});

test("rejects unsupported, unrelated, and view-source pages", () => {
    const context = loadWorker();

    for (const url of [
        "https://example.com/",
        "https://www.codewars.com/users/example"
    ]) {
        assert.throws(
            () => vm.runInContext(`getPlatform('${url}')`, context),
            /not a supported coding exercise page/
        );
    }

    assert.throws(
        () => vm.runInContext(
            "getPlatform('view-source:https://exercism.org/tracks/c/exercises/hello-world/edit')",
            context
        ),
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
