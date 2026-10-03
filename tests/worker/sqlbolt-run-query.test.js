/* @machine
file: tests/worker/sqlbolt-run-query.test.js
role: verify SQLBolt Ctrl+Enter dispatches the focused Run Query action
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR } = require("../worker-test-harness.js");

function loadSqlBoltShortcut(buttonLabel = "RUN QUERY") {
    const listeners = [];
    let clicks = 0;
    const runQuery = {
        textContent: buttonLabel,
        click: () => { clicks += 1; }
    };
    const container = {
        querySelector: selector => selector === "a.submit" ? runQuery : null
    };
    const editor = {
        closest: selector => selector === ".sqlinput_container" ? container : null
    };
    const context = vm.createContext({
        document: {
            addEventListener: (type, listener, capture) =>
                listeners.push({ type, listener, capture })
        }
    });

    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "worker", "sqlbolt", "run_query.js"), "utf8"),
        context
    );

    return { ...listeners[0], clicks: () => clicks, editor };
}

function createEvent({ target, ...overrides } = {}) {
    const calls = [];
    return {
        event: {
            key: "Enter",
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            target,
            preventDefault: () => calls.push("preventDefault"),
            stopPropagation: () => calls.push("stopPropagation"),
            stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
            ...overrides
        },
        calls
    };
}

test("runs the paired SQLBolt query on Ctrl+Enter from its editor", () => {
    const { listener, type, capture, clicks, editor } = loadSqlBoltShortcut();
    const target = { closest: selector => selector === ".sqlinput" ? editor : null };
    const { event, calls } = createEvent({ target });

    listener(event);

    assert.equal(type, "keydown");
    assert.equal(capture, true);
    assert.equal(clicks(), 1);
    assert.deepEqual(calls, [
        "preventDefault",
        "stopPropagation",
        "stopImmediatePropagation"
    ]);
});

test("ignores other keys, extra modifiers, non-editors, and non-Run links", () => {
    const { listener, clicks, editor } = loadSqlBoltShortcut("RESET");
    const target = { closest: selector => selector === ".sqlinput" ? editor : null };
    const ignoredEvents = [
        createEvent({ target, key: "a" }),
        createEvent({ target, ctrlKey: false }),
        createEvent({ target, altKey: true }),
        createEvent({ target, shiftKey: true }),
        createEvent({ target, metaKey: true }),
        createEvent({ target: { closest: () => null } })
    ];

    for (const { event, calls } of ignoredEvents) {
        listener(event);
        assert.deepEqual(calls, []);
    }

    assert.equal(clicks(), 0);
});
