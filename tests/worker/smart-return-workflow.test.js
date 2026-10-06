/* @machine
file: tests/worker/smart-return-workflow.test.js
role: verify Smart Return completion is independent of adapter submission
run: npm run test:smart-return
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadCoreWorker } = require("../worker-test-harness.js");

test("pending adapter submission does not block consecutive Smart Returns", async () => {
    const context = loadCoreWorker();
    const sourceTab = {
        id: 11,
        windowId: 7,
        url: "https://exercism.org/tracks/x86-64-assembly/exercises/freelancer-rates/edit"
    };
    const llmTab = {
        id: 22,
        windowId: 7,
        url: "https://chat.deepseek.com/a/chat/s/test"
    };
    context.tabState.push(sourceTab, llmTab);
    context.chrome.tabs.get = async tabId => context.tabState.find(tab => tab.id === tabId);

    let resolveSubmission;
    const pendingSubmission = new Promise(resolve => {
        resolveSubmission = resolve;
    });
    const replacedPayloads = [];
    let submissionRequests = 0;
    context.SmartReturn.readClipboard = async () => "";
    context.SmartReturn.replaceCode = async (_tabId, text) => {
        replacedPayloads.push(text);
    };
    context.SmartReturn.submitReturnedCode = () => {
        submissionRequests += 1;
        return pendingSubmission;
    };

    const firstRoute = await context.SmartReturn.routes.save({
        windowId: 7,
        llmTabId: 22,
        sourceTabId: 11,
        sourceUrl: sourceTab.url,
        sourcePlatform: "Exercism",
        sourceIdentity: "Exercism:x86-64-assembly:freelancer-rates",
        copied: true,
        copiedText: "first distinct invalid payload"
    });

    const completeFirst = await Promise.race([
        context.SmartReturn.run(llmTab, "return:first").then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 250))
    ]);
    assert.equal(completeFirst, true, "first return must not await adapter submission");
    assert.equal(submissionRequests, 1);
    assert.deepEqual(replacedPayloads, ["first distinct invalid payload"]);
    assert.equal((await context.SmartReturn.routes.get(7, 22)).copied, false);
    assert.equal((await context.SmartReturn.routes.get(7, 22)).copiedText, "");

    await context.SmartReturn.routes.save({
        ...firstRoute,
        copied: true,
        copiedText: "second distinct invalid payload"
    });
    const completeSecond = await Promise.race([
        context.SmartReturn.run(llmTab, "return:second").then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 250))
    ]);

    assert.equal(completeSecond, true, "pending first submission must not block the next return");
    assert.equal(submissionRequests, 2);
    assert.deepEqual(replacedPayloads, [
        "first distinct invalid payload",
        "second distinct invalid payload"
    ]);
    assert.equal((await context.SmartReturn.routes.get(7, 22)).copied, false);
    assert.equal((await context.SmartReturn.routes.get(7, 22)).copiedText, "");
    resolveSubmission();
});

test("keeps the route when the source tab navigates to another domain", async () => {
    const context = loadCoreWorker();
    const sourceTab = {
        id: 11,
        windowId: 7,
        url: "https://course.example/lesson/one"
    };
    const llmTab = {
        id: 22,
        windowId: 7,
        url: "https://chat.deepseek.com/a/chat/s/test"
    };
    context.tabState.push(sourceTab, llmTab);
    context.chrome.tabs.get = async tabId => context.tabState.find(tab => tab.id === tabId);
    context.SmartReturn.readClipboard = async () => "";

    await context.SmartReturn.routes.save({
        windowId: 7,
        llmTabId: 22,
        sourceTabId: 11,
        sourceUrl: sourceTab.url,
        sourcePlatform: "Web source",
        sourceIdentity: "https://course.example/lesson/one",
        copied: false,
        copiedText: ""
    });

    sourceTab.url = "https://cdn.example/course/lesson/one";
    await context.SmartReturn.run(llmTab, "return:cross-domain");
    assert.ok(await context.SmartReturn.routes.get(7, 22));
    assert.equal((await context.SmartReturn.routes.get(7, 22)).sourceTabId, 11);
});

test("retries a return payload that arrives after the first clipboard read", async () => {
    const context = loadCoreWorker();
    const sourceTab = {
        id: 11,
        windowId: 7,
        url: "https://exercism.org/tracks/x86-64-assembly/exercises/freelancer-rates/edit"
    };
    const llmTab = {
        id: 22,
        windowId: 7,
        url: "https://chat.deepseek.com/a/chat/s/test"
    };
    context.tabState.push(sourceTab, llmTab);
    context.chrome.tabs.get = async tabId => context.tabState.find(tab => tab.id === tabId);

    let clipboardReads = 0;
    context.SmartReturn.readClipboard = async () => {
        clipboardReads += 1;
        if (clipboardReads === 1) {
            const currentRoute = await context.SmartReturn.routes.get(7, 22);
            await context.SmartReturn.routes.updateIfCurrent(currentRoute, {
                copied: true,
                copiedText: "late copied payload"
            });
        }
        return "";
    };
    const replacedPayloads = [];
    context.SmartReturn.replaceCode = async (_tabId, text) => {
        replacedPayloads.push(text);
    };

    await context.SmartReturn.routes.save({
        windowId: 7,
        llmTabId: 22,
        sourceTabId: 11,
        sourceUrl: sourceTab.url,
        sourcePlatform: "Exercism",
        sourceIdentity: "Exercism:x86-64-assembly:freelancer-rates",
        copied: false,
        copiedText: ""
    });

    await context.SmartReturn.run(llmTab, "return:late-copy");

    assert.equal(clipboardReads, 2);
    assert.deepEqual(replacedPayloads, ["late copied payload"]);
});