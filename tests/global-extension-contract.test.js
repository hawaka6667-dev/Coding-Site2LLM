/*
 * Global extension maintenance contracts: manifest and Chrome wiring.
 * Run this during global maintenance, not during ordinary feature development.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");

function readManifest() {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));
}

test("keeps extension commands and content scripts registered", () => {
    const manifest = readManifest();

    assert.equal(manifest.commands["run-workflow"].suggested_key.default, "Alt+Q");
    assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
    assert.deepEqual(
        manifest.content_scripts[1].js,
        ["worker/auto_mark_exercism_complete.js"]
    );
    assert.equal(manifest.commands["exercism-test-submit"], undefined);
});

test("keeps mark-complete separate from Ctrl+Enter submission", () => {
    const contentSource = fs.readFileSync(path.join(ROOT_DIR, "content.js"), "utf8");
    const adapterSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "extract_coding_site_context_with_site_adapters.js"),
        "utf8"
    );
    const testAndSubmit = adapterSource.slice(
        adapterSource.indexOf("async testAndSubmit(tabId)"),
        adapterSource.indexOf("async getContext(tabId)")
    );

    assert.match(contentSource, /exercism-test-submit/);
    assert.match(adapterSource, /completeExercismExercise\(tabId\)/);
    assert.doesNotMatch(testAndSubmit, /markComplete|completeExercismExercise/);
});

test("keeps the extension icon assets registered", () => {
    const manifest = readManifest();

    assert.deepEqual(manifest.action.default_icon, {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
    });
    for (const iconPath of Object.values(manifest.action.default_icon)) {
        assert.equal(fs.existsSync(path.join(ROOT_DIR, iconPath)), true);
    }
});
