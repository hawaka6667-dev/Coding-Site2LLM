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

test("includes Kimi and matches custom providers by exact origin", async () => {
    const context = loadRoutingWorker({
        tabs: [{ id: 1, index: 0, windowId: 1, url: "https://coding.example/" }]
    });
    context.chrome.storage.local.get = async () => ({
        selectedLlmProvider: "Local LLM",
        customLlmProviders: [{ name: "Local LLM", url: "http://localhost:3000/chat" }]
    });
    const result = vm.runInContext(`(() => {
        const providers = getLlmProviders([
            { name: "Local LLM", url: "http://localhost:3000/chat" },
            { name: "Bad URL", url: "javascript:alert(1)" },
            { name: "DeepSeek", url: "https://duplicate.example/" }
        ]);
        const custom = providers.find(provider => provider.name === "Local LLM");
        return {
            kimi: providers.find(provider => provider.name === "Kimi")?.match("https://kimi.com/"),
            custom: custom?.match("http://localhost:3000/conversation/1"),
            wrongOrigin: custom?.match("http://localhost:3001/"),
            invalidAdded: providers.some(provider => provider.name === "Bad URL"),
            builtinNameNotOverridden: providers.find(provider => provider.name === "DeepSeek").url
        };
    })()`, context);

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        kimi: true,
        custom: true,
        wrongOrigin: false,
        invalidAdded: false,
        builtinNameNotOverridden: "https://chat.deepseek.com/"
    });

    const selected = await context.getSelectedLlmProvider();
    const target = await context.findLlmTab(
        { id: 1, index: 0, windowId: 1 },
        selected
    );
    assert.equal(selected.name, "Local LLM");
    assert.equal(target.tab.url, "http://localhost:3000/chat");
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
