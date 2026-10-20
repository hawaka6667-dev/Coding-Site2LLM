/* @machine
file: tests/worker/smart-return-workflow.test.js
role: verify Smart Return completion is independent of adapter submission
run: npm run test:smart-return
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadCoreWorker } = require("../worker-test-harness.js");

test("recognizes Brainfuck snippets as code without accepting plain explanations", () => {
    const context = loadCoreWorker();

    assert.equal(context.SmartReturn.isLikelyCode("+++++[>++++++++<-]>+.---."), true);
    assert.equal(context.SmartReturn.isLikelyCode("++[>++<-]\n."), true);
    assert.equal(context.SmartReturn.isLikelyCode("A short explanation of the loop."), false);
});

test("recognizes Haskell function equations and type signatures", () => {
    const context = loadCoreWorker();

    assert.equal(context.SmartReturn.isLikelyCode("doubleMe x = x + x"), true);
    assert.equal(context.SmartReturn.isLikelyCode("doubleMe :: Int -> Int\ndoubleMe x = x * 2"), true);
    assert.equal(context.SmartReturn.isLikelyCode("The answer equals 42."), false);
});

test("recognizes Lean proofs only for Adam Math HHU", () => {
    const context = loadCoreWorker();
    const proof = "by\n  rw [add_zero]\n  rfl";

    assert.equal(context.SmartReturn.isLikelyCode(proof, "Adam Math HHU"), true);
    assert.equal(context.SmartReturn.isLikelyCode(proof), false);
    assert.equal(
        context.SmartReturn.isLikelyCode("I would solve this by induction on n.", "Adam Math HHU"),
        false
    );
});

test("accepts Monaco-handled paste when its hidden input area is cleared", async () => {
    const context = loadCoreWorker();
    const sourceTab = {
        id: 11,
        url: "https://adam.math.hhu.de/#/g/leanprover-community/nng4/world/Addition/level/3"
    };
    const expected = "theorem add_comm (a b : ℕ) : a + b = b + a := by\n  induction b with d hd\n  rw [zero_add]\n  rw [add_zero]";
    let editorValue = "theorem old_theorem : True := by\n  trivial";
    let allSelected = false;
    const events = [];

    class MockDataTransfer {
        values = new Map();
        setData(type, value) { this.values.set(type, value); }
        getData(type) { return this.values.get(type) || ""; }
    }
    class MockKeyboardEvent {
        constructor(type, options) { Object.assign(this, options, { type }); }
    }
    class MockClipboardEvent {
        constructor(type, options) {
            Object.assign(this, options, { type, defaultPrevented: false });
        }
        preventDefault() { this.defaultPrevented = true; }
    }

    const input = {
        value: editorValue,
        focus() {},
        dispatchEvent(event) {
            events.push(event.type);
            if (event.type === "keydown" && event.ctrlKey && event.key === "a") {
                allSelected = true;
            }
            if (event.type === "paste" && allSelected) {
                editorValue = event.clipboardData.getData("text/plain");
                this.value = "";
                event.preventDefault();
            }
        }
    };
    const editor = {
        offsetWidth: 600,
        offsetHeight: 192,
        querySelector(selector) {
            assert.equal(selector, "textarea.inputarea");
            return input;
        }
    };

    context.chrome.tabs.get = async tabId => tabId === sourceTab.id ? sourceTab : null;
    context.document = {
        querySelectorAll(selector) {
            assert.equal(selector, ".codeview .monaco-editor");
            return [editor];
        }
    };
    context.DataTransfer = MockDataTransfer;
    context.KeyboardEvent = MockKeyboardEvent;
    context.ClipboardEvent = MockClipboardEvent;
    context.executePage = async (_tabId, callback, args = []) => callback(...args);

    await context.SmartReturn.replaceCode(sourceTab.id, expected);

    assert.equal(editorValue, expected);
    assert.equal(input.value, "");
    assert.deepEqual(events, ["keydown", "keyup", "paste"]);
});

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

test("shows and manually changes the Smart Return target", async () => {
    const context = loadCoreWorker();
    const tabA = { id: 11, windowId: 7, title: "A", url: "https://course.example/a" };
    const tabB = { id: 12, windowId: 7, title: "B", url: "https://course.example/b" };
    const llmTab = { id: 22, windowId: 7, title: "chat", url: "https://chat.deepseek.com/a/chat/s/test" };
    const secondLlmTab = { id: 23, windowId: 7, title: "claude", url: "https://claude.ai/" };
    context.tabState.push(tabA, tabB, llmTab, secondLlmTab);
    context.chrome.tabs.get = async tabId => context.tabState.find(tab => tab.id === tabId);

    let state = await context.SmartReturn.getTargetState(7, 22);
    assert.equal(state.llmTabId, 22);
    assert.equal(state.target, null);
    assert.deepEqual(state.candidates.map(tab => tab.tabId), [11, 12]);

    await context.SmartReturn.setTarget(22, 11);
    state = await context.SmartReturn.getTargetState(7, 23);
    assert.equal(state.llmTabId, 23);
    assert.equal(state.target.tabId, 11);

    await context.SmartReturn.setTarget(22, 12);
    assert.equal((await context.SmartReturn.routes.get(7, 22)).sourceTabId, 12);
    assert.equal((await context.SmartReturn.routes.get(7, 23)).sourceTabId, 12);

    const laterProviderTab = {
        id: 24,
        windowId: 7,
        title: "Kimi",
        url: "https://kimi.com/"
    };
    context.tabState.push(laterProviderTab);
    state = await context.SmartReturn.getTargetState(7, laterProviderTab.id);
    assert.equal(state.target.tabId, 12);

    await context.SmartReturn.recordCopy(laterProviderTab.id, "Kimi answer");
    const laterProviderRoute = await context.SmartReturn.routes.get(7, laterProviderTab.id);
    assert.equal(laterProviderRoute.sourceTabId, 12);
    assert.equal(laterProviderRoute.copiedText, "Kimi answer");
});

test("records copied payloads for configured custom provider tabs", async () => {
    const context = loadCoreWorker();
    const sourceTab = { id: 11, windowId: 7, url: "https://course.example/a" };
    const customLlmTab = { id: 23, windowId: 7, url: "https://llm.example/chat" };
    context.tabState.push(sourceTab, customLlmTab);
    context.chrome.storage = {
        local: {
            get: async () => ({
                customLlmProviders: [{ name: "Custom LLM", url: "https://llm.example/" }]
            }),
            set: async () => {}
        }
    };
    await context.SmartReturn.routes.save({
        windowId: 7,
        llmTabId: 23,
        sourceTabId: 11,
        copied: false,
        copiedText: ""
    });

    await context.SmartReturn.recordCopy(23, "custom provider answer");

    const route = await context.SmartReturn.routes.get(7, 23);
    assert.equal(route.copied, true);
    assert.equal(route.copiedText, "custom provider answer");
});

