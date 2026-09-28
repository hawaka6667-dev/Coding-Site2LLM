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

    assert.match(helper, /Documentation-only changes, tests, and bug fixes do not increment the version/);
    assert.match(helper, /new features increment the patch version by `0\.01`/);
    assert.match(helper, /Git tags and GitHub Releases retain the release history/);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.equal(
        packageJson.scripts["package:crx"],
        "powershell -ExecutionPolicy Bypass -File .build/package.ps1"
    );
    assert.equal(
        packageJson.scripts.release,
        "powershell -ExecutionPolicy Bypass -File .build/release.ps1"
    );
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

    assert.ok(
        current[0] > previous[0] ||
        (current[0] === previous[0] && current[1] > previous[1]) ||
        (current[0] === previous[0] &&
            current[1] === previous[1] &&
            current[2] > previous[2]),
        `manifest version ${manifest.version} must advance beyond v${previousRelease}`
    );
});