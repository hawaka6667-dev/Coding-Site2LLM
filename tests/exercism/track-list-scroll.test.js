/* @machine
file: tests/exercism/track-list-scroll.test.js
role: verify Exercism track-list scroll restoration
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR } = require("../worker-test-harness.js");

test("stops restoring concepts scroll on exercise pages and resumes on return", () => {
    const windowListeners = new Map();
    const documentListeners = new Map();
    const animationFrames = [];
    const scrollCalls = [];
    let mutationCallback;
    const storageKey = "codingSite2LlmExercismTrackListScroll:/tracks/go/concepts";
    const storedPositions = new Map([[storageKey, "4200"]]);
    const window = {
        scrollY: 0,
        addEventListener: (type, listener) => windowListeners.set(type, listener),
        scrollTo: (x, y) => scrollCalls.push(y)
    };
    const document = {
        documentElement: {},
        body: {},
        addEventListener: (type, listener) => documentListeners.set(type, listener)
    };
    class MutationObserver {
        constructor(callback) {
            mutationCallback = callback;
        }
        observe() {}
    }
    const context = vm.createContext({
        document,
        location: { pathname: "/tracks/go/concepts", search: "" },
        window,
        sessionStorage: {
            getItem: key => storedPositions.get(key) ?? null,
            setItem: (key, value) => storedPositions.set(key, String(value))
        },
        MutationObserver,
        requestAnimationFrame: callback => animationFrames.push(callback),
        setTimeout: () => 1,
        clearTimeout() {}
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "preserve_track_list_scroll_position.js"),
            "utf8"
        ),
        context
    );

    documentListeners.get("turbo:before-visit")();
    context.location.pathname = "/tracks/go/exercises/the-farm";
    documentListeners.get("turbo:load")();
    mutationCallback();
    animationFrames.shift()();
    assert.deepEqual(scrollCalls, []);

    context.location.pathname = "/tracks/go/concepts";
    documentListeners.get("turbo:load")();
    animationFrames.shift()();
    assert.deepEqual(scrollCalls, [4200]);
});

test("restores and saves the Exercism concepts page scroll position", () => {
    const storage = new Map([
        ["codingSite2LlmExercismTrackListScroll:/tracks/go/concepts", "640"]
    ]);
    const windowListeners = new Map();
    const documentListeners = new Map();
    let onLayoutChange;
    const window = {
        scrollY: 0,
        addEventListener: (type, listener) => windowListeners.set(type, listener),
        scrollTo: (_left, top) => {
            window.scrollY = top;
        }
    };
    const context = vm.createContext({
        document: {
            body: {},
            documentElement: {},
            addEventListener: (type, listener) => documentListeners.set(type, listener)
        },
        location: { pathname: "/tracks/go/concepts", search: "" },
        requestAnimationFrame: callback => callback(),
        setTimeout: () => 1,
        clearTimeout: () => {},
        MutationObserver: class {
            constructor(callback) {
                onLayoutChange = callback;
            }
            observe() {}
        },
        ResizeObserver: class {
            constructor(callback) {
                this.callback = callback;
            }
            observe() {}
        },
        sessionStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value))
        },
        window
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "preserve_track_list_scroll_position.js"),
            "utf8"
        ),
        context
    );

    assert.equal(window.scrollY, 640);
    window.scrollY = 1400;
    onLayoutChange();
    assert.equal(window.scrollY, 640);

    windowListeners.get("wheel")();
    window.scrollY = 825;
    windowListeners.get("scroll")();
    assert.equal(
        storage.get("codingSite2LlmExercismTrackListScroll:/tracks/go/concepts"),
        "825"
    );
    assert.equal(typeof windowListeners.get("pagehide"), "function");
    assert.equal(typeof documentListeners.get("turbo:load"), "function");
});
