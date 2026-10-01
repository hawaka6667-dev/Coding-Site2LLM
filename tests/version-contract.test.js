/* @machine
file: tests/version-contract.test.js
role: enforce the release version rules documented in helper.md
run: npm run test:version
*/

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const SOURCE_ROOT = path.join(ROOT_DIR, "src");
const DIST_ROOT = path.join(ROOT_DIR, "dist");

function readJson(file, basePath = ROOT_DIR) {
    return JSON.parse(fs.readFileSync(path.join(basePath, file), "utf8"));
}

test("uses the version policy documented in helper.md", () => {
    const helper = fs.readFileSync(path.join(ROOT_DIR, "helper.md"), "utf8");
    const manifest = readJson("manifest.json", DIST_ROOT);
    const packageJson = readJson("package.json");
    const builder = fs.readFileSync(path.join(ROOT_DIR, ".build", "build-extension.js"), "utf8");
    const packager = fs.readFileSync(path.join(ROOT_DIR, ".build", "package.ps1"), "utf8");
    const versionManager = fs.readFileSync(path.join(ROOT_DIR, ".build", "version.ps1"), "utf8");
    const tasks = readJson(".vscode/tasks.json");

    assert.match(helper, /Every delivered change increments the four-part extension version/);
    assert.match(helper, /four-part extension version `major\.minor\.batch\.change`/);
    assert.match(helper, /increments the final segment by `0\.0\.0\.1`/);
    assert.match(helper, /increments the batch segment by `0\.0\.1`/);
    assert.match(helper, /increment the minor segment by `0\.1\.0\.0`/);
    assert.match(helper, /increment the major segment by `1\.0\.0\.0`/);
    assert.match(helper, /Git tags and GitHub Releases retain the release history/);
    assert.match(manifest.version, /^\d+\.\d+\.\d+\.\d+$/);
    assert.equal(
        packageJson.scripts["package:crx"],
        "powershell -ExecutionPolicy Bypass -File .build/package.ps1"
    );
    assert.equal(
        packageJson.scripts.release,
        "powershell -ExecutionPolicy Bypass -File .build/release.ps1"
    );
    assert.equal(
        packageJson.scripts.version,
        "powershell -ExecutionPolicy Bypass -File .build/version.ps1 -Level Change"
    );
    assert.equal(
        packageJson.scripts["version:batch"],
        "powershell -ExecutionPolicy Bypass -File .build/version.ps1 -Level Batch"
    );
    assert.equal(
        packageJson.scripts["version:minor"],
        "powershell -ExecutionPolicy Bypass -File .build/version.ps1 -Level Minor"
    );
    assert.ok(tasks.tasks.some((task) => task.label === "Version: +0.001 (Batch)" && task.script === "version:batch"));
    assert.ok(tasks.tasks.some((task) => task.label === "Version: +0.01 (Minor)" && task.script === "version:minor"));
    assert.match(versionManager, /ValidateSet\("Change", "Batch", "Minor", "Major"\)/);
    assert.doesNotMatch(versionManager, /Assert-VersionTagAvailable|\$Action/);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, ".build", "version.ps1")), true);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, ".build", "package.ps1")), true);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, ".build", "release.ps1")), true);
    assert.equal(
        packageJson.scripts["build:extension"],
        "node .build/build-extension.js"
    );
    assert.match(builder, /icons\/icon-preview\.html/);
    assert.match(packager, /Join-Path \$projectRoot "dist"/);
    assert.match(packager, /--pack-extension=\$distRoot/);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, "manifest.json")), false);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, "extension")), false);
    assert.equal(fs.existsSync(path.join(SOURCE_ROOT, "icons", "icon-preview.html")), true);
});

test("current feature release advances beyond the previous release tag", () => {
    const manifest = readJson("manifest.json", DIST_ROOT);
    const latestTag = execFileSync(
        "git",
        ["tag", "--list", "--sort=-version:refname"],
        { cwd: ROOT_DIR, encoding: "utf8" }
    ).trim().split(/\r?\n/)[0];
    const previousRelease = latestTag.replace(/^v/, "");
    const current = manifest.version.split(".").map(Number);
    const previous = previousRelease.split(".").map(Number);
    while (previous.length < current.length) {
        previous.push(0);
    }
    const advances = current.some((part, index) => {
        const previousPart = previous[index] || 0;
        if (part !== previousPart) {
            return part > previousPart && current
                .slice(0, index)
                .every((prefix, prefixIndex) => prefix === previous[prefixIndex]);
        }
        return false;
    });

    assert.ok(
        advances,
        `manifest version ${manifest.version} must advance beyond v${previousRelease}`
    );
});