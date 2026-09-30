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

test("coordinates overview window creation and completion close from the owning content script", async () => {
    const editorTab = {
        id: 7,
        windowId: 3,
        url: "https://exercism.org/tracks/go/exercises/lasagna/edit"
    };
    const context = loadRoutingWorker({ tabs: [editorTab] });
    const pageListeners = new Map();
    const runtimeMessageListeners = [];
    const replacements = [];
    const removedWindows = [];
    context.chrome.windows.remove = async windowId => removedWindows.push(windowId);
    const overviewTab = {
        id: 21,
        windowId: 21,
        url: "https://exercism.org/tracks/go/exercises/lasagna?via=back-link"
    };
    context.chrome.tabs.query = async details => details?.windowId === 21
        ? [overviewTab]
        : [editorTab];

    function sendWorkerMessage(message, tab) {
        return new Promise(resolve => {
            for (const listener of context.messageListeners) {
                const keepChannelOpen = listener(message, { tab }, resolve);
                if (keepChannelOpen !== true) {
                    resolve(undefined);
                }
            }
        });
    }
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
            storage: { local: { get: async () => ({ exercismAutoMarkComplete: true }) } },
            runtime: {
                onMessage: { addListener: listener => runtimeMessageListeners.push(listener) },
                sendMessage: message => sendWorkerMessage(
                    message,
                    pageContext.location.href.endsWith("/edit") ? editorTab : overviewTab
                )
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
                "manage_submitted_exercism_overview_window.js"
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
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(overviewVisit.prevented, true);
    assert.deepEqual(replacements, [editorTab.url]);
    assert.equal(JSON.stringify(context.createdWindows), JSON.stringify([{
        url: "https://exercism.org/tracks/go/exercises/lasagna?via=back-link",
        focused: false
    }]));
    assert.equal(context.createdTabs.length, 0);

    pageContext.location.href = overviewTab.url;
    for (const listener of runtimeMessageListeners) {
        listener({
            type: "exercism-submitted-overview-completion-result",
            completed: true
        }, {});
    }
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(removedWindows, [21]);

    const disabledContext = loadRoutingWorker({
        tabs: [editorTab],
        autoMarkComplete: false
    });
    const disabledMessages = [];
    const disabledListeners = new Map();
    const disabledPage = vm.createContext({
        URL,
        Date,
        document: {
            addEventListener: (type, listener) => disabledListeners.set(type, listener),
            querySelectorAll: () => [backToExerciseLink]
        },
        location: { href: editorTab.url, replace: url => replacements.push(url) },
        chrome: {
            storage: { local: { get: async () => ({ exercismAutoMarkComplete: false }) } },
            runtime: {
                onMessage: { addListener: () => {} },
                sendMessage: message => disabledMessages.push(message)
            }
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(
            ROOT_DIR,
            "worker",
            "exercism",
            "edit",
            "manage_submitted_exercism_overview_window.js"
        ), "utf8"),
        disabledPage
    );
    disabledListeners.get("click")({
        target: { closest: () => ({ disabled: false }) }
    });
    const disabledVisit = {
        detail: { url: "https://exercism.org/tracks/go/exercises/lasagna" },
        preventDefault() {}
    };
    disabledListeners.get("turbo:before-visit")(disabledVisit);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disabledMessages.length, 0);
    assert.equal(replacements.at(-1), backToExerciseLink.href);

    const invalidTargetContext = loadRoutingWorker({ tabs: [editorTab] });
    const invalidRequest = new Promise(resolve => invalidTargetContext.messageListeners[0](
        {
            type: "exercism-create-submitted-overview-window",
            overviewUrl: "https://evil.example/tracks/go/exercises/lasagna"
        },
        { tab: editorTab },
        resolve
    ));
    assert.equal((await invalidRequest).opened, false);
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
