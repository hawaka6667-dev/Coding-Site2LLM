/* @machine
file: tests/worker/computable-secrets-lesson-navigation.test.js
role: verify Computable Secrets lesson navigation and automatic lesson checks
run: node --test tests/worker/computable-secrets-lesson-navigation.test.js
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
    "computable_secrets",
    "lesson_navigation.js"
);

function loadPage(url = "https://computablesecrets.com/learn/leanlings/nng?lesson=Tutorial%2Frw_backwards") {
    const listeners = new Map();
    let mutationHandler;
    let buttons = [];
    let summaries = [];
    const document = {
        documentElement: {},
        addEventListener: (name, handler) => listeners.set(name, handler),
        querySelectorAll: selector => {
            if (selector === "button") {
                return buttons;
            }
            assert.equal(selector, "summary");
            return summaries;
        }
    };
    const context = vm.createContext({
        URL,
        location: new URL(url),
        document,
        MutationObserver: class {
            constructor(callback) {
                mutationHandler = callback;
            }

            observe(target, options) {
                assert.equal(target, document.documentElement);
                assert.equal(options.childList, true);
                assert.equal(options.subtree, true);
            }
        }
    });

    vm.runInContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context);

    return {
        context,
        setButtons: value => { buttons = value; },
        setSummaries: value => { summaries = value; },
        notifyMutation: () => mutationHandler(),
        listeners
    };
}

function createButton(text = "Check exercise", { disabled = false } = {}) {
    let clicks = 0;
    return {
        innerText: text,
        offsetWidth: 120,
        offsetHeight: 40,
        disabled,
        getAttribute: () => null,
        click: () => { clicks += 1; },
        clicks: () => clicks
    };
}

function createWorkedSolutionSummary(open = false) {
    const details = { tagName: "DETAILS", open };
    let clicks = 0;
    return {
        innerText: "Read a worked solution",
        offsetWidth: 240,
        offsetHeight: 24,
        parentElement: details,
        click: () => {
            clicks += 1;
            details.open = true;
        },
        clicks: () => clicks,
        isOpen: () => details.open
    };
}

test("checks once when the button appears and once again after changing lessons", () => {
    const page = loadPage();
    const firstButton = createButton();

    page.setButtons([firstButton]);
    page.notifyMutation();
    page.notifyMutation();

    assert.equal(firstButton.clicks(), 1);

    page.context.location.href =
        "https://computablesecrets.com/learn/leanlings/nng?lesson=Tutorial%2Fadd_assoc";
    const nextButton = createButton();
    page.setButtons([nextButton]);
    page.notifyMutation();

    assert.equal(nextButton.clicks(), 1);
});

test("waits for an enabled visible Check exercise button", () => {
    const page = loadPage();
    const disabledButton = createButton("Check exercise", { disabled: true });

    page.setButtons([disabledButton]);
    page.notifyMutation();
    assert.equal(disabledButton.clicks(), 0);

    const readyButton = createButton();
    page.setButtons([readyButton]);
    page.notifyMutation();
    assert.equal(readyButton.clicks(), 1);
});

test("opens the worked solution once per lesson without closing an already open one", () => {
    const page = loadPage();
    const firstSummary = createWorkedSolutionSummary();

    page.setSummaries([firstSummary]);
    page.notifyMutation();
    page.notifyMutation();

    assert.equal(firstSummary.clicks(), 1);
    assert.equal(firstSummary.isOpen(), true);

    page.context.location.href =
        "https://computablesecrets.com/learn/leanlings/nng?lesson=Tutorial%2Fadd_assoc";
    const alreadyOpenSummary = createWorkedSolutionSummary(true);
    page.setSummaries([alreadyOpenSummary]);
    page.notifyMutation();

    assert.equal(alreadyOpenSummary.clicks(), 0);
    assert.equal(alreadyOpenSummary.isOpen(), true);
});