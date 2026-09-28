/* @machine
file: tests/worker/return-routing.test.js
role: verify return-route identity and target selection
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadCoreWorker } = require("../worker-test-harness.js");

test("keeps LeetCode maintenance across same-problem routes and clears it on a new problem", async () => {
    const context = loadCoreWorker();
    const route = {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "LeetCode",
        sourceUrl: "https://leetcode.com/problems/two-sum/",
        copied: true,
        copiedText: "old problem answer"
    };
    context.route = route;
    vm.runInContext("returnRoutes = { '1:20': route }", context);

    context.tabUpdatedListeners[0](10, {
        status: "loading",
        url: route.sourceUrl
    }, {
        id: 10,
        windowId: 1,
        url: route.sourceUrl
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(vm.runInContext("returnRoutes['1:20']", context), route);

    context.historyStateUpdatedListeners[0]({
        tabId: 10,
        frameId: 0,
        url: "https://leetcode.com/problems/two-sum/submissions/2154894608/?envType=study-plan-v2&envId=leetcode-75"
    }, {
        id: 10,
        windowId: 1,
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(vm.runInContext("returnRoutes['1:20']", context), route);

    context.tabUpdatedListeners[0](10, {
        url: "https://leetcode.com/problems/maximum-subarray/"
    }, {
        id: 10,
        windowId: 1,
        url: "https://leetcode.com/problems/maximum-subarray/"
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(vm.runInContext("returnRoutes['1:20']", context), undefined);

    const tabUpdates = [];
    context.chrome.tabs.update = async (...args) => tabUpdates.push(args);
    await vm.runInContext("returnToCodingPage({ id: 20, windowId: 1 })", context);
    assert.equal(tabUpdates.length, 0);

    await vm.runInContext(`saveReturnRoute({
        ...route,
        sourceUrl: "https://leetcode.com/problems/maximum-subarray/"
    })`, context);

    assert.equal(
        vm.runInContext("returnRoutes['1:20'].sourceUrl", context),
        "https://leetcode.com/problems/maximum-subarray/"
    );
});

test("clears maintained return routes when History API navigation changes the exercise", async () => {
    const context = loadCoreWorker();
    const route = {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "Exercism",
        sourceUrl: "https://exercism.org/tracks/go/exercises/lasagna/edit"
    };
    context.route = route;
    vm.runInContext("returnRoutes = { '1:20': route }", context);

    context.historyStateUpdatedListeners[0]({
        tabId: 10,
        frameId: 0,
        url: "https://exercism.org/tracks/go/exercises/freelancer/edit"
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(vm.runInContext("returnRoutes['1:20']", context), undefined);
});

test("keeps Exercism overview maintenance when the same exercise moves into edit", async () => {
    const context = loadCoreWorker();
    const route = {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "Exercism overview",
        sourceUrl: "https://exercism.org/tracks/go/exercises/lasagna"
    };
    context.route = route;
    vm.runInContext("returnRoutes = { '1:20': route }", context);

    context.historyStateUpdatedListeners[0]({
        tabId: 10,
        frameId: 0,
        url: "https://exercism.org/tracks/go/exercises/lasagna/edit"
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(vm.runInContext("returnRoutes['1:20']", context), route);
});

test("Smart Return resolves an Exercism overview route to its matching editor", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        {
            id: 10,
            windowId: 1,
            index: 2,
            url: "https://exercism.org/tracks/go/exercises/lasagna"
        },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" },
        {
            id: 30,
            windowId: 1,
            index: 3,
            url: "https://exercism.org/tracks/go/exercises/lasagna/edit"
        },
        {
            id: 40,
            windowId: 1,
            index: 4,
            url: "https://exercism.org/tracks/go/exercises/freelancer/edit"
        }
    );
    vm.runInContext(`returnRoutes = { '1:20': {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "Exercism overview",
        sourceUrl: "https://exercism.org/tracks/go/exercises/lasagna"
    } }`, context);
    const tabUpdates = [];
    context.chrome.tabs.update = async (...args) => tabUpdates.push(args);

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1, index: 1 })",
        context
    );

    assert.equal(tabUpdates[0][0], 30);
    assert.equal(tabUpdates[0][1].active, true);
});

test("keeps a maintained return route on a hash change within the same Codewars kata", async () => {
    const context = loadCoreWorker();
    const route = {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "Codewars",
        sourceUrl: "https://www.codewars.com/kata/example/train/javascript"
    };
    context.route = route;
    vm.runInContext("returnRoutes = { '1:20': route }", context);

    context.referenceFragmentUpdatedListeners[0]({
        tabId: 10,
        frameId: 0,
        url: `${route.sourceUrl}#solution`
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(vm.runInContext("returnRoutes['1:20']", context), route);
});

test("Smart Return clears a stale route before using a source tab with a new URL", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        {
            id: 10,
            windowId: 1,
            index: 1,
            url: "https://leetcode.com/problems/maximum-subarray/"
        },
        { id: 20, windowId: 1, index: 0, url: "https://chat.deepseek.com/" }
    );
    vm.runInContext(`returnRoutes = { '1:20': {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "LeetCode",
        sourceUrl: "https://leetcode.com/problems/two-sum/",
        copied: true,
        copiedText: "old problem answer"
    } }`, context);
    const tabUpdates = [];
    context.chrome.tabs.update = async (...args) => tabUpdates.push(args);

    await vm.runInContext("returnToCodingPage({ id: 20, windowId: 1 })", context);

    assert.equal(tabUpdates.length, 0);
    assert.equal(vm.runInContext("returnRoutes['1:20']", context), undefined);
});

test("Smart Return finds the matching LeetCode editor from a same-problem submissions tab", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        {
            id: 10,
            windowId: 1,
            index: 2,
            url: "https://leetcode.com/problems/two-sum/submissions/2154894608/"
        },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" },
        {
            id: 30,
            windowId: 1,
            index: 3,
            url: "https://leetcode.com/problems/two-sum/"
        },
        {
            id: 40,
            windowId: 1,
            index: 4,
            url: "https://leetcode.com/problems/maximum-subarray/"
        }
    );
    vm.runInContext(`returnRoutes = { '1:20': {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "LeetCode",
        sourceUrl: "https://leetcode.com/problems/two-sum/"
    } }`, context);
    const tabUpdates = [];
    context.chrome.tabs.update = async (...args) => tabUpdates.push(args);

    await vm.runInContext(
        "returnToCodingPage({ id: 20, windowId: 1, index: 1 })",
        context
    );

    assert.equal(tabUpdates[0][0], 30);
    assert.equal(tabUpdates[0][1].active, true);
});

test("Smart Return does not use a different LeetCode problem as a fallback", async () => {
    const context = loadCoreWorker();
    context.tabState.push(
        {
            id: 10,
            windowId: 1,
            index: 2,
            url: "https://leetcode.com/problems/two-sum/submissions/2154894608/"
        },
        { id: 20, windowId: 1, index: 1, url: "https://chat.deepseek.com/" },
        {
            id: 30,
            windowId: 1,
            index: 3,
            url: "https://leetcode.com/problems/maximum-subarray/"
        }
    );
    vm.runInContext(`returnRoutes = { '1:20': {
        windowId: 1,
        sourceTabId: 10,
        llmTabId: 20,
        sourcePlatform: "LeetCode",
        sourceUrl: "https://leetcode.com/problems/two-sum/"
    } }`, context);
    const tabUpdates = [];
    context.chrome.tabs.update = async (...args) => tabUpdates.push(args);

    await vm.runInContext("returnToCodingPage({ id: 20, windowId: 1 })", context);

    assert.equal(tabUpdates.length, 0);
    assert.equal(vm.runInContext("returnRoutes['1:20'].sourceTabId", context), null);
});
