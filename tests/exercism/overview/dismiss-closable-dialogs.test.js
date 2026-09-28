/* @machine
file: tests/exercism/overview/dismiss-closable-dialogs.test.js
role: verify dismissal of overview dialogs
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR } = require("../../worker-test-harness.js");

test("dismisses any closable dialog that appears after an Exercism overview loads", () => {
    let dialogVisible = false;
    let closeCount = 0;
    let mutationCallback;
    const dialog = {
        innerText: "A notification unrelated to exercise completion",
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
        querySelectorAll: () => [closeButton]
    };
    const closeButton = {
        disabled: false,
        innerText: "",
        getAttribute: name => name === "aria-label" ? "Close" : null,
        getBoundingClientRect: () => ({ width: 48, height: 48 }),
        click: () => {
            dialogVisible = false;
            closeCount += 1;
        }
    };
    const document = {
        documentElement: {},
        addEventListener: () => {},
        querySelectorAll: () => dialogVisible ? [dialog] : []
    };
    class MutationObserver {
        constructor(callback) {
            mutationCallback = callback;
        }
        observe() {}
    }
    const context = vm.createContext({ document, MutationObserver });

    vm.runInContext(
        fs.readFileSync(
            path.join(
                ROOT_DIR,
                "worker",
                "exercism",
                "overview",
                "dismiss_exercism_overview_closable_dialogs.js"
            ),
            "utf8"
        ),
        context
    );

    dialogVisible = true;
    mutationCallback();

    assert.equal(dialogVisible, false);
    assert.equal(closeCount, 1);
});
