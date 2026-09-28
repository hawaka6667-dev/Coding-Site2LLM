/* @machine
file: tests/routing/llm-provider-selection.test.js
role: verify LLM provider tab reuse and placement
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadRoutingWorker } = require("../worker-test-harness.js");

test("recognizes valid LLM provider URLs only", () => {
    const context = loadRoutingWorker();
    const result = vm.runInContext(
        "LLM_PROVIDERS.some(provider => provider.match('https://deepai.org/chat')) && !LLM_PROVIDERS.some(provider => provider.match('https://deepai.org.evil.example/'))",
        context
    );

    assert.equal(result, true);
});

test("finds the selected provider to the left and opens it to the left otherwise", async () => {
    const leftProviderTab = { id: 2, index: 1, url: "https://claude.ai/" };
    const rightProviderTab = { id: 3, index: 3, url: "https://claude.ai/" };
    const currentTab = { id: 4, index: 2, windowId: 1 };
    const context = loadRoutingWorker({
        tabs: [leftProviderTab, currentTab, rightProviderTab]
    });
    context.currentTab = currentTab;

    const reused = await vm.runInContext(
        "findLlmTab(currentTab, LLM_PROVIDERS.find(provider => provider.name === 'Claude'))",
        context
    );

    assert.equal(reused.tab.id, leftProviderTab.id);

    const createdTabs = [];
    context.chrome.tabs.create = async details => {
        createdTabs.push(details);
        return { id: 5, ...details };
    };
    const noLeftProviderContext = loadRoutingWorker({
        tabs: [
            { id: 6, index: 1, url: "https://chatgpt.com/" },
            currentTab,
            rightProviderTab
        ]
    });
    noLeftProviderContext.currentTab = currentTab;
    noLeftProviderContext.chrome.tabs.create = async details => {
        createdTabs.push(details);
        return { id: 7, ...details };
    };

    const created = await vm.runInContext(
        "findLlmTab(currentTab, LLM_PROVIDERS.find(provider => provider.name === 'Claude'))",
        noLeftProviderContext
    );

    assert.equal(created.tab.id, 7);
    assert.equal(
        JSON.stringify(createdTabs.at(-1)),
        JSON.stringify({
            windowId: 1,
            index: 2,
            url: "https://claude.ai/",
            active: false
        })
    );
});
