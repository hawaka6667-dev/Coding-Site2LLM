/* @machine
file: tests/exercism/submission-workflow.test.js
role: verify Exercism submission workflow
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR, loadRoutingWorker } = require("../worker-test-harness.js");

test("opens the same submitted Exercism overview in an unfocused window only when enabled", async () => {
    const editorTab = {
        id: 7,
        windowId: 3,
        url: "https://exercism.org/tracks/go/exercises/lasagna/edit"
    };
    const context = loadRoutingWorker({ tabs: [editorTab] });
    const pageListeners = new Map();
    const replacements = [];
    const backToExerciseLink = {
        innerText: "Back to Exercise",
        href: "https://exercism.org/tracks/go/exercises/lasagna?via=back-link",
        offsetWidth: 100,
        offsetHeight: 20,
        getAttribute: () => null
    };
    const pageContext = vm.createContext({
        URL,
        Date,
        document: {
            addEventListener: (type, listener) => {
                const listeners = pageListeners.get(type) || [];
                listeners.push(listener);
                pageListeners.set(type, listeners);
            },
            querySelectorAll: () => [backToExerciseLink]
        },
        location: {
            href: editorTab.url,
            replace: url => replacements.push(url)
        },
        chrome: {
            runtime: {
                sendMessage: message => {
                    for (const listener of context.messageListeners) {
                        listener(message, { tab: editorTab }, () => {});
                    }
                }
            }
        }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(
                ROOT_DIR,
                "worker",
                "exercism",
                "edit",
                "return_to_editor_after_submit_redirect.js"
            ),
            "utf8"
        ),
        pageContext
    );
    const clickListeners = pageListeners.get("click");
    const beforeVisitListeners = pageListeners.get("turbo:before-visit");
    const submitButton = { disabled: false };
    clickListeners[0]({
        target: {
            closest: selector => selector === ".lhs-footer .submit-btn button"
                ? submitButton
                : null
        }
    });
    const overviewVisit = {
        detail: { url: "https://exercism.org/tracks/go/exercises/lasagna" },
        prevented: false,
        preventDefault() {
            this.prevented = true;
        }
    };
    beforeVisitListeners[0](overviewVisit);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(overviewVisit.prevented, true);
    assert.deepEqual(replacements, [editorTab.url]);
    assert.equal(JSON.stringify(context.createdWindows), JSON.stringify([{
        url: "https://exercism.org/tracks/go/exercises/lasagna?via=back-link",
        focused: false
    }]));
    assert.equal(context.createdTabs.length, 0);

    const disabledContext = loadRoutingWorker({
        tabs: [editorTab],
        autoMarkComplete: false
    });
    disabledContext.messageListeners[0](
        {
            type: "exercism-open-submitted-overview",
            overviewUrl: "https://exercism.org/tracks/go/exercises/lasagna"
        },
        { tab: editorTab },
        () => {}
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disabledContext.createdWindows.length, 0);

    const invalidTargetContext = loadRoutingWorker({ tabs: [editorTab] });
    invalidTargetContext.messageListeners[0](
        {
            type: "exercism-open-submitted-overview",
            overviewUrl: "https://evil.example/tracks/go/exercises/lasagna"
        },
        { tab: editorTab },
        () => {}
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(invalidTargetContext.createdWindows.length, 0);
});

test("returns after triggering the Exercism Submit action without relying on modal copy", async () => {
    async function triggerSubmit() {
        let submitted = false;
        let timestamp = 0;
        const submitButton = {
            offsetWidth: 100,
            offsetHeight: 24,
            disabled: false,
            click: () => { submitted = true; }
        };
        const context = loadRoutingWorker();
        context.document = {
            querySelector: selector => selector === ".lhs-footer .run-tests-btn button"
                ? { offsetWidth: 100, offsetHeight: 24, disabled: true }
                : submitButton,
            querySelectorAll: selector => selector === '[role="status"]' ? [] : []
        };
        context.performance = { now: () => (timestamp += 1000) };
        vm.runInContext(
            "executePage = async (_tabId, pageFunction, args = []) => pageFunction(...args); sleep = async () => {}",
            context
        );

        const result = await vm.runInContext(
            "ExercismAdapter.testAndSubmit(7, { skipRun: true })",
            context
        );

        return { result, submitted };
    }

    assert.deepEqual(await triggerSubmit(), { result: true, submitted: true });
});
