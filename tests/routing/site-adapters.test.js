/* @machine
file: tests/routing/site-adapters.test.js
role: verify site routing and editor adapters
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadRoutingWorker } = require("../worker-test-harness.js");

test("routes supported exercise pages to their adapters", () => {
    const context = loadRoutingWorker();
    const result = vm.runInContext(
        "({ exercism: getPlatform('https://exercism.org/tracks/c/exercises/hello-world/edit').name, overview: getPlatform('https://exercism.org/tracks/c/exercises/hello-world').name, leetcode: getPlatform('https://leetcode.com/problems/two-sum/').name, leetcodeSubmissions: getPlatform('https://leetcode.com/problems/dota2-senate/submissions/2154894608/?envType=study-plan-v2&envId=leetcode-75').name, codewars: getPlatform('https://www.codewars.com/kata/55c45be3b2079ecccb00010b/train/javascript').name })",
        context
    );

    assert.equal(JSON.stringify(result), JSON.stringify({
        exercism: "Exercism",
        overview: "Exercism overview",
        leetcode: "LeetCode",
        leetcodeSubmissions: "LeetCode",
        codewars: "Codewars"
    }));
});

test("falls back to raw source for unrelated HTTP pages and rejects view-source pages", () => {
    const context = loadRoutingWorker();

    assert.equal(
        vm.runInContext("getPlatform('https://example.com/').name", context),
        "Web source"
    );
    assert.equal(
        vm.runInContext("getPlatform('https://www.codewars.com/users/example').name", context),
        "Web source"
    );

    assert.throws(
        () => vm.runInContext(
            "getPlatform('view-source:https://exercism.org/tracks/c/exercises/hello-world/edit')",
            context
        ),
        /Open the normal Exercism page instead of view-source/
    );
});
