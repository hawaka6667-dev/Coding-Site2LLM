/* @machine
file: tests/worker/learncodefast-mark-complete.test.js
role: verify LearnCodeFast completion control automation
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR } = require("../worker-test-harness.js");

function loadLearnCodeFastPage({ url, buttons }) {
    const observers = [];
    const listeners = new Map();
    const scheduledCallbacks = [];
    const historyMethods = {
        pushState: function () {},
        replaceState: function () {}
    };
    const context = vm.createContext({
        location: { href: url },
        history: historyMethods,
        setTimeout: callback => scheduledCallbacks.push(callback),
        addEventListener: (eventName, callback) => listeners.set(eventName, callback),
        document: {
            documentElement: {},
            querySelectorAll: selector => selector === "button" ? buttons : []
        },
        MutationObserver: class {
            constructor(callback) {
                observers.push(callback);
            }

            observe() {}
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "learncodefast", "course_page_automation.js"),
            "utf8"
        ),
        context
    );

    return {
        triggerMutation: () => observers[0](),
        triggerNavigation: eventName => listeners.get(eventName)?.(),
        runScheduledCallbacks: () => scheduledCallbacks.splice(0).forEach(callback => callback()),
        context
    };
}

function createButton({ text = "Mark as Complete", visible = true, disabled = false } = {}) {
    let clicks = 0;
    return {
        innerText: text,
        offsetWidth: visible ? 100 : 0,
        offsetHeight: visible ? 40 : 0,
        disabled,
        getAttribute: () => null,
        click: () => { clicks += 1; },
        clicks: () => clicks
    };
}

test("clicks a visible LearnCodeFast Mark as Complete button once", () => {
    const button = createButton();
    const { triggerMutation } = loadLearnCodeFastPage({
        url: "https://learncodefast.org/courses/python/regex",
        buttons: [button]
    });

    triggerMutation();
    triggerMutation();

    assert.equal(button.clicks(), 1);
});

test("waits for an eligible button and ignores other pages and controls", () => {
    const hiddenButton = createButton({ visible: false });
    const disabledButton = createButton({ disabled: true });
    const buttons = [hiddenButton, disabledButton];
    const { triggerMutation } = loadLearnCodeFastPage({
        url: "https://learncodefast.org/courses/python/regex",
        buttons
    });

    const eligibleButton = createButton();
    buttons.push(eligibleButton);
    triggerMutation();

    assert.equal(hiddenButton.clicks(), 0);
    assert.equal(disabledButton.clicks(), 0);
    assert.equal(eligibleButton.clicks(), 1);

    const otherPageButton = createButton();
    const otherPage = loadLearnCodeFastPage({
        url: "https://example.com/courses/python/regex",
        buttons: [otherPageButton]
    });
    otherPage.triggerMutation();
    assert.equal(otherPageButton.clicks(), 0);
});

test("rescans after SPA history navigation even without a DOM mutation", () => {
    const firstButton = createButton({ text: "Lesson Complete" });
    const { context, runScheduledCallbacks } = loadLearnCodeFastPage({
        url: "https://learncodefast.org/courses/powershell/intro",
        buttons: [firstButton]
    });
    const nextButton = createButton();

    context.document.querySelectorAll = selector => selector === "button" ? [nextButton] : [];
    context.location.href = "https://learncodefast.org/courses/powershell/cmdlets";
    context.history.pushState({}, "", "/courses/powershell/cmdlets");
    runScheduledCallbacks();

    assert.equal(nextButton.clicks(), 1);
});

test("keeps scanning when the lesson button mounts after navigation", () => {
    const buttons = [];
    const { context, runScheduledCallbacks } = loadLearnCodeFastPage({
        url: "https://learncodefast.org/courses/powershell/intro",
        buttons
    });
    const nextButton = createButton();

    context.location.href = "https://learncodefast.org/courses/powershell/cmdlets";
    context.history.pushState({}, "", "/courses/powershell/cmdlets");
    buttons.push(nextButton);
    runScheduledCallbacks();

    assert.equal(nextButton.clicks(), 1);
});