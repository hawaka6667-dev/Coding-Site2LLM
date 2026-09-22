/*
 * Fast development-environment checks.
 * Use this only after moving files or changing package and manifest entry points.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");

test("has the expected development entry points and scripts", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));

    for (const file of [
        "background.js",
        "content.js",
        "worker/configure_supported_coding_sites_and_llm_providers.js",
        "worker/auto_mark_exercism_complete.js"
    ]) {
        assert.equal(fs.existsSync(path.join(ROOT_DIR, file)), true, file);
    }

    assert.equal(typeof packageJson.scripts["test:unit"], "string");
    assert.equal(typeof packageJson.scripts["test:routing"], "string");
    assert.equal(typeof packageJson.scripts["test:contracts"], "string");
    assert.equal(typeof packageJson.scripts["test:setup"], "string");
    assert.equal(manifest.background.service_worker, "background.js");
});
