/* @machine
file: tests/routing/coding-tab-selection.test.js
role: verify same-platform coding tab selection
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadRoutingWorker } = require("../worker-test-harness.js");

test("finds the nearest same-platform coding tab to the right of the LLM tab", () => {
    const context = loadRoutingWorker();
    const tabs = [
        { id: 1, index: 0, url: "https://chat.deepseek.com/" },
        { id: 2, index: 1, url: "https://leetcode.com/problems/two-sum/" },
        { id: 3, index: 2, url: "https://exercism.org/tracks/go/exercises/hello-world/edit" },
        { id: 4, index: 3, url: "https://exercism.org/tracks/go/exercises/anagram/edit" },
        { id: 5, index: 4, url: "https://example.com/" }
    ];

    assert.equal(
        vm.runInContext(
            "findRightCodingTab(tabs, tabs[0], 'Exercism').id",
            vm.createContext({ ...context, tabs })
        ),
        3
    );
});
