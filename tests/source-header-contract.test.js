const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SOURCE_ROOT = path.join(__dirname, "..", "src");

test("documents core workers with a machine header", () => {
    const modules = [
        "worker/diagnostics.js",
        "worker/state/return_route_store.ts",
        "worker/workflows/smart_return_workflow.ts",
        "worker/workflows/exercism_workflow.ts",
        "worker/workflows/run_coding_context_to_llm_workflow.ts"
    ];

    for (const modulePath of modules) {
        const source = fs.readFileSync(path.join(SOURCE_ROOT, modulePath), "utf8");
        const header = source.slice(0, source.indexOf("*/") + 2);

        assert.match(header, /^\/\* @machine/m, `${modulePath} needs an @machine header`);
    }
});