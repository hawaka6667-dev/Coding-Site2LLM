/* @machine
file: tests/worker/diagnostics.test.js
role: verify centralized workflow diagnostics and privacy filtering
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..", "..");
const diagnosticsSource = fs.readFileSync(
    path.join(ROOT_DIR, "src", "worker", "diagnostics.js"),
    "utf8"
);

test("forwards correlated events while dropping non-whitelisted content", async () => {
    const messages = [];
    const context = vm.createContext({
        chrome: {
            runtime: {
                sendMessage: async message => messages.push(message)
            }
        },
        console,
        crypto: { randomUUID: () => "operation-1" },
        document: {},
        globalThis: null
    });
    context.globalThis = context;

    vm.runInContext(diagnosticsSource, context);
    const logger = context.CodingSite2LlmDiagnostics;
    logger.log("send-context", logger.createOperationId(), "context.captured", {
        tabId: 7,
        platform: "Exercism",
        prompt: "private prompt",
        source: "private solution"
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "coding-site2llm-diagnostic");
    assert.equal(messages[0].event.operationId, "operation-1");
    assert.equal(messages[0].event.stage, "context.captured");
    assert.deepEqual(JSON.parse(JSON.stringify(messages[0].event.details)), {
        tabId: 7,
        platform: "Exercism"
    });
});

test("writes worker events directly to the service worker console", () => {
    const output = [];
    const context = vm.createContext({
        console: { info: (...args) => output.push(args) },
        crypto: { randomUUID: () => "operation-2" },
        globalThis: null
    });
    context.globalThis = context;

    vm.runInContext(diagnosticsSource, context);
    context.CodingSite2LlmDiagnostics.log(
        "smart-return",
        "operation-2",
        "workflow.started",
        { sourceTabId: 3 }
    );

    assert.equal(output.length, 1);
    assert.equal(output[0][0], "[CodingSite2LLM]");
    assert.equal(output[0][1].operationId, "operation-2");
    assert.equal(output[0][1].details.sourceTabId, 3);
});

test("writes content-script events with their sender tab ID", () => {
    const output = [];
    const context = vm.createContext({
        console: { info: (...args) => output.push(args) },
        globalThis: null
    });
    context.globalThis = context;

    vm.runInContext(diagnosticsSource, context);
    context.CodingSite2LlmDiagnostics.write({
        operationId: "operation-3",
        workflow: "exercism-mark-complete",
        stage: "control.ready",
        details: { title: "private exercise title" }
    }, 42);

    assert.equal(output.length, 1);
    assert.equal(output[0][1].operationId, "operation-3");
    assert.deepEqual(JSON.parse(JSON.stringify(output[0][1].details)), {
        tabId: 42
    });
});