/* @machine
file: tests/exercism/edit/submit-redirect.test.js
role: verify return to the Exercism editor after submit
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE_ROOT = path.join(__dirname, "..", "..", "..", "src");

test("returns to the same Exercism editor after the submitted overview window opens", async () => {
    const listeners = [];
    const replacements = [];
    const messages = [];
    const backToExerciseLink = {
        innerText: "Back to Exercise",
        href: "https://exercism.org/tracks/python/exercises/pov?from=editor",
        offsetWidth: 100,
        offsetHeight: 20,
        getAttribute: () => null
    };
    const document = {
        addEventListener: (type, listener, capture) =>
            listeners.push({ type, listener, capture }),
        querySelectorAll: () => [backToExerciseLink]
    };
    let now = 1000;
    const context = vm.createContext({
        URL,
        Date: { now: () => now },
        document,
        chrome: {
            storage: { local: { get: async () => ({ exercismAutoMarkComplete: true }) } },
            runtime: {
                onMessage: { addListener: () => {} },
                sendMessage: message => {
                    messages.push(message);
                    return Promise.resolve({ opened: true });
                }
            }
        },
        location: {
            href: "https://exercism.org/tracks/python/exercises/pov/edit",
            replace: url => replacements.push(url)
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(
                SOURCE_ROOT,
                "worker",
                "exercism",
                "submitted_overview",
                "open_submitted_overview_after_submit.js"
            ),
            "utf8"
        ),
        context
    );

    const submitClickListener = listeners.find(listener => listener.type === "click");
    const beforeVisitListener = listeners.find(
        listener => listener.type === "turbo:before-visit"
    );
    const submitButton = { disabled: false };
    const clickEvent = {
        target: { closest: selector =>
            selector === ".lhs-footer .submit-btn button" ? submitButton : null
        }
    };
    submitClickListener.listener(clickEvent);

    const overviewVisit = {
        detail: {
            url: "https://exercism.org/tracks/python/exercises/pov"
        },
        prevented: false,
        preventDefault() {
            this.prevented = true;
        }
    };
    beforeVisitListener.listener(overviewVisit);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(overviewVisit.prevented, true);
    assert.deepEqual(replacements, [
        "https://exercism.org/tracks/python/exercises/pov/edit"
    ]);
    assert.equal(JSON.stringify(messages), JSON.stringify([{
        type: "exercism-create-submitted-overview-window",
        overviewUrl: "https://exercism.org/tracks/python/exercises/pov?from=editor",
        editorUrl: "https://exercism.org/tracks/python/exercises/pov/edit"
    }]));

    const nextOverviewVisit = {
        detail: {
            url: "https://exercism.org/tracks/python/exercises/pov"
        },
        prevented: false,
        preventDefault() {
            this.prevented = true;
        }
    };
    beforeVisitListener.listener(nextOverviewVisit);
    assert.equal(nextOverviewVisit.prevented, false);
    assert.equal(replacements.length, 1);
    assert.equal(messages.length, 1);

    submitClickListener.listener(clickEvent);
    now += 1;
    const loadedOverviewListener = listeners.find(
        listener => listener.type === "turbo:load"
    );
    context.location.href = "https://exercism.org/tracks/python/exercises/other";
    loadedOverviewListener.listener();
    assert.equal(replacements.length, 1);

    context.location.href = "https://exercism.org/tracks/python/exercises/pov/edit";
    submitClickListener.listener(clickEvent);
    context.location.href = "https://exercism.org/tracks/python/exercises/pov";
    loadedOverviewListener.listener();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(replacements, [
        "https://exercism.org/tracks/python/exercises/pov/edit",
        "https://exercism.org/tracks/python/exercises/pov/edit"
    ]);
    assert.equal(messages.length, 2);
});

test("returns to the overview when automatic completion is disabled", async () => {
    const listeners = [];
    const replacements = [];
    const messages = [];
    const backToExerciseLink = {
        innerText: "Back to Exercise",
        href: "https://exercism.org/tracks/python/exercises/pov?from=editor",
        offsetWidth: 100,
        offsetHeight: 20,
        getAttribute: () => null
    };
    const context = vm.createContext({
        URL,
        Date,
        document: {
            addEventListener: (type, listener) => listeners.push({ type, listener }),
            querySelectorAll: () => [backToExerciseLink]
        },
        chrome: {
            storage: { local: { get: async () => ({ exercismAutoMarkComplete: false }) } },
            runtime: {
                onMessage: { addListener() {} },
                sendMessage: message => {
                    messages.push(message);
                    return Promise.resolve({ opened: true });
                }
            }
        },
        location: {
            href: "https://exercism.org/tracks/python/exercises/pov/edit",
            replace: url => replacements.push(url)
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(
                SOURCE_ROOT,
                "worker",
                "exercism",
                "submitted_overview",
                "open_submitted_overview_after_submit.js"
            ),
            "utf8"
        ),
        context
    );

    listeners.find(listener => listener.type === "click").listener({
        target: { closest: () => ({ disabled: false }) }
    });
    const overviewVisit = {
        detail: { url: "https://exercism.org/tracks/python/exercises/pov" },
        prevented: false,
        preventDefault() { this.prevented = true; }
    };
    listeners.find(listener => listener.type === "turbo:before-visit").listener(overviewVisit);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(overviewVisit.prevented, true);
    assert.deepEqual(replacements, [backToExerciseLink.href]);
    assert.deepEqual(messages, []);
});

test("opens the submitted overview when Exercism returns to the same editor URL", async () => {
    const listeners = [];
    const replacements = [];
    const messages = [];
    const editorUrl = "https://exercism.org/tracks/python/exercises/pov/edit";
    const overviewUrl = "https://exercism.org/tracks/python/exercises/pov?from=editor";
    const backToExerciseLink = {
        innerText: "Back to Exercise",
        href: overviewUrl,
        offsetWidth: 100,
        offsetHeight: 20,
        getAttribute: () => null
    };
    const context = vm.createContext({
        URL,
        Date,
        document: {
            addEventListener: (type, listener, capture) =>
                listeners.push({ type, listener, capture }),
            querySelectorAll: () => [backToExerciseLink]
        },
        chrome: {
            storage: { local: { get: async () => ({ exercismAutoMarkComplete: true }) } },
            runtime: {
                onMessage: { addListener() {} },
                sendMessage: message => {
                    messages.push(message);
                    return Promise.resolve({ opened: true });
                }
            }
        },
        location: {
            href: editorUrl,
            replace: url => replacements.push(url)
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(
                SOURCE_ROOT,
                "worker",
                "exercism",
                "submitted_overview",
                "open_submitted_overview_after_submit.js"
            ),
            "utf8"
        ),
        context
    );

    const submitClickListener = listeners.find(listener => listener.type === "click");
    const beforeVisitListener = listeners.find(
        listener => listener.type === "turbo:before-visit"
    );
    const submitClick = {
        target: { closest: () => ({ disabled: false }) }
    };
    submitClickListener.listener(submitClick);

    const editorVisit = {
        detail: { url: editorUrl },
        prevented: false,
        preventDefault() { this.prevented = true; }
    };
    beforeVisitListener.listener(editorVisit);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(editorVisit.prevented, true);
    assert.deepEqual(replacements, [editorUrl]);
    assert.equal(JSON.stringify(messages), JSON.stringify([{
        type: "exercism-create-submitted-overview-window",
        overviewUrl,
        editorUrl
    }]));

    submitClickListener.listener(submitClick);
    const loadedEditorListener = listeners.find(listener => listener.type === "turbo:load");
    loadedEditorListener.listener();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(replacements, [editorUrl, editorUrl]);
    assert.equal(messages.length, 2);
});
