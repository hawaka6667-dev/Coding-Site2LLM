/* @machine
file: tests/worker/adam-math-hhu-navigation.test.js
role: verify Adam Math HHU arrow navigation and editor exclusion
run: node --test tests/worker/adam-math-hhu-navigation.test.js
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..", "..");
const SCRIPT_PATH = path.join(
    ROOT_DIR,
    "src",
    "worker",
    "adam_math_hhu",
    "level_navigation.js"
);

function loadPage({
    url = "https://adam.math.hhu.de/#/g/leanprover-community/nng4/world/Tutorial/level/6",
    activeElement = null,
    controls = []
} = {}) {
    const listeners = new Map();
    const context = vm.createContext({
        location: new URL(url),
        document: {
            activeElement,
            addEventListener: (name, handler, capture) => {
                assert.equal(name, "keydown");
                assert.equal(capture, true);
                listeners.set(name, handler);
            },
            querySelectorAll: selector => {
                assert.equal(selector, "a[title], button[title]");
                return controls;
            }
        }
    });

    vm.runInContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context);

    return listeners.get("keydown");
}

function createControl(title) {
    let clicks = 0;
    return {
        title,
        offsetWidth: 80,
        offsetHeight: 32,
        disabled: false,
        getAttribute: () => null,
        click: () => { clicks += 1; },
        clicks: () => clicks
    };
}

function createKeyEvent(key, target = {}) {
    let prevented = false;
    let stopped = false;
    return {
        event: {
            key,
            target,
            repeat: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            preventDefault: () => { prevented = true; },
            stopPropagation: () => { stopped = true; }
        },
        wasPrevented: () => prevented,
        wasStopped: () => stopped
    };
}

test("left and right arrows click Previous and Next level links", () => {
    const previous = createControl("previous level");
    const next = createControl("next level");
    const handleKeydown = loadPage({ controls: [previous, next] });
    const left = createKeyEvent("ArrowLeft");
    const right = createKeyEvent("ArrowRight");

    handleKeydown(left.event);
    handleKeydown(right.event);

    assert.equal(previous.clicks(), 1);
    assert.equal(next.clicks(), 1);
    assert.equal(left.wasPrevented(), true);
    assert.equal(right.wasPrevented(), true);
});

test("does not intercept arrows while the target or focus is in Monaco", () => {
    const previous = createControl("previous level");
    const next = createControl("next level");
    const editor = {};
    const textarea = {
        closest: selector => selector.includes(".monaco-editor") ? editor : null
    };
    const body = { closest: () => null };
    const handleKeydown = loadPage({
        activeElement: textarea,
        controls: [previous, next]
    });
    const fromEditor = createKeyEvent("ArrowLeft", textarea);
    const focusInEditor = createKeyEvent("ArrowRight", body);

    handleKeydown(fromEditor.event);
    handleKeydown(focusInEditor.event);

    assert.equal(previous.clicks(), 0);
    assert.equal(next.clicks(), 0);
    assert.equal(fromEditor.wasPrevented(), false);
    assert.equal(focusInEditor.wasPrevented(), false);
    assert.equal(fromEditor.wasStopped(), false);
    assert.equal(focusInEditor.wasStopped(), false);
});

test("ignores non-level routes and modified or repeated arrow presses", () => {
    const previous = createControl("previous level");
    const next = createControl("next level");
    const handleKeydown = loadPage({
        url: "https://adam.math.hhu.de/#/g/leanprover-community/nng4/world/Tutorial",
        controls: [previous, next]
    });
    const repeated = createKeyEvent("ArrowLeft");
    repeated.event.repeat = true;
    const modified = createKeyEvent("ArrowRight");
    modified.event.altKey = true;

    handleKeydown(repeated.event);
    handleKeydown(modified.event);

    assert.equal(previous.clicks(), 0);
    assert.equal(next.clicks(), 0);
    assert.equal(repeated.wasPrevented(), false);
    assert.equal(modified.wasPrevented(), false);
});