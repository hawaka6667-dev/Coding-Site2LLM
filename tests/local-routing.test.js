/* @machine
file: tests/local-routing.test.js
role: verify routing, adapters, providers, overview redirect
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");

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

test("rechecks Exercism auto-completion after Turbo navigation", async () => {
    const documentListeners = new Map();
    const messages = [];
    let hasMarkComplete = false;
    const button = {
        innerText: "Mark as complete",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false
    };
    const document = {
        documentElement: {},
        addEventListener: (type, listener) => documentListeners.set(type, listener),
        querySelectorAll: () => hasMarkComplete ? [button] : []
    };
    class MutationObserver {
        observe() {}
    }
    const context = vm.createContext({
        chrome: {
            storage: { local: { get: async () => ({}) } },
            runtime: { sendMessage: message => messages.push(message) }
        },
        document,
        location: { href: "https://exercism.org/tracks/go/exercises/example/edit" },
        MutationObserver,
        console
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "overview", "auto_mark_exercise_complete.js"),
            "utf8"
        ),
        context
    );
    await new Promise(resolve => setImmediate(resolve));

    hasMarkComplete = true;
    context.location.href = "https://exercism.org/tracks/go/exercises/example";
    documentListeners.get("turbo:load")();
    await new Promise(resolve => setImmediate(resolve));

    documentListeners.get("turbo:render")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 1);

    context.location.href = "https://exercism.org/tracks/go/exercises/another-example";
    documentListeners.get("turbo:load")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 2);
    assert.equal(messages.every(message => message.type === "exercism-mark-complete"), true);
});

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
            path.join(ROOT_DIR, "worker", "exercism", "concepts_and_exercises", "preserve_track_list_scroll_position.js"),
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

function loadWorker({ tabs = [], autoMarkComplete = true } = {}) {
    const messageListeners = [];
    const createdTabs = [];
    const createdWindows = [];
    const removedTabs = [];
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: listener => messageListeners.push(listener) } },
        scripting: { executeScript: async () => [{ result: true }] },
        storage: {
            local: { get: async () => ({ exercismAutoMarkComplete: autoMarkComplete }) }
        },
        tabs: {
            query: async () => tabs,
            get: async tabId => tabs.find(tab => tab.id === tabId),
            create: async properties => {
                createdTabs.push(properties);
                return { id: createdTabs.length + 10, ...properties };
            },
            remove: async tabId => removedTabs.push(tabId),
            update: async () => {}
        },
        windows: {
            create: async properties => {
                createdWindows.push(properties);
                return { id: createdWindows.length + 20, ...properties };
            }
        }
    };
    const context = vm.createContext({ chrome, console, performance, setTimeout, URL });
    context.importScripts = (...files) => {
        for (const file of files) {
            vm.runInContext(
                fs.readFileSync(path.join(ROOT_DIR, file), "utf8"),
                context,
                { filename: file }
            );
        }
    };
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    context.messageListeners = messageListeners;
    context.createdTabs = createdTabs;
    context.createdWindows = createdWindows;
    context.removedTabs = removedTabs;
    return context;
}

test("routes supported exercise pages to their adapters", () => {
    const context = loadWorker();
    const result = vm.runInContext(
        "({ exercism: getPlatform('https://exercism.org/tracks/c/exercises/hello-world/edit').name, overview: getPlatform('https://exercism.org/tracks/c/exercises/hello-world').name, leetcode: getPlatform('https://leetcode.com/problems/two-sum/').name, codewars: getPlatform('https://www.codewars.com/kata/55c45be3b2079ecccb00010b/train/javascript').name })",
        context
    );

    assert.equal(JSON.stringify(result), JSON.stringify({
        exercism: "Exercism",
        overview: "Exercism overview",
        leetcode: "LeetCode",
        codewars: "Codewars"
    }));
});

test("opens the same submitted Exercism overview in an unfocused window only when enabled", async () => {
    const editorTab = {
        id: 7,
        windowId: 3,
        url: "https://exercism.org/tracks/go/exercises/lasagna/edit"
    };
    const context = loadWorker({ tabs: [editorTab] });
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

    const disabledContext = loadWorker({
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

    const invalidTargetContext = loadWorker({ tabs: [editorTab] });
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
        const context = loadWorker();
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

test("falls back to raw source for unrelated HTTP pages and rejects view-source pages", () => {
    const context = loadWorker();

    assert.equal(
        vm.runInContext("getPlatform('https://example.com/').name", context),
        "Web source"
    );
    assert.equal(
        vm.runInContext("getPlatform('https://www.codewars.com/users/example').name", context),
        "Web source"
    );

    assert.throws(
        () => vm.runInContext(
            "getPlatform('view-source:https://exercism.org/tracks/c/exercises/hello-world/edit')",
            context
        ),
        /Open the normal Exercism page instead of view-source/
    );
});

test("recognizes valid LLM provider URLs only", () => {
    const context = loadWorker();
    const result = vm.runInContext(
        "LLM_PROVIDERS.some(provider => provider.match('https://deepai.org/chat')) && !LLM_PROVIDERS.some(provider => provider.match('https://deepai.org.evil.example/'))",
        context
    );

    assert.equal(result, true);
});

test("finds the selected provider to the left and opens it to the left otherwise", async () => {
    const leftProviderTab = { id: 2, index: 1, url: "https://claude.ai/" };
    const rightProviderTab = { id: 3, index: 3, url: "https://claude.ai/" };
    const currentTab = { id: 4, index: 2, windowId: 1 };
    const context = loadWorker({
        tabs: [leftProviderTab, currentTab, rightProviderTab]
    });
    context.currentTab = currentTab;

    const reused = await vm.runInContext(
        "findLlmTab(currentTab, LLM_PROVIDERS.find(provider => provider.name === 'Claude'))",
        context
    );

    assert.equal(reused.tab.id, leftProviderTab.id);

    const createdTabs = [];
    context.chrome.tabs.create = async details => {
        createdTabs.push(details);
        return { id: 5, ...details };
    };
    const noLeftProviderContext = loadWorker({
        tabs: [
            { id: 6, index: 1, url: "https://chatgpt.com/" },
            currentTab,
            rightProviderTab
        ]
    });
    noLeftProviderContext.currentTab = currentTab;
    noLeftProviderContext.chrome.tabs.create = async details => {
        createdTabs.push(details);
        return { id: 7, ...details };
    };

    const created = await vm.runInContext(
        "findLlmTab(currentTab, LLM_PROVIDERS.find(provider => provider.name === 'Claude'))",
        noLeftProviderContext
    );

    assert.equal(created.tab.id, 7);
    assert.equal(
        JSON.stringify(createdTabs.at(-1)),
        JSON.stringify({
            windowId: 1,
            index: 2,
            url: "https://claude.ai/",
            active: false
        })
    );
});

test("finds the nearest same-platform coding tab to the right of the LLM tab", () => {
    const context = loadWorker();
    const tabs = [
        { id: 1, index: 0, url: "https://chat.deepseek.com/" },
        { id: 2, index: 1, url: "https://leetcode.com/problems/two-sum/" },
        { id: 3, index: 2, url: "https://exercism.org/tracks/go/exercises/hello-world/edit" },
        { id: 4, index: 3, url: "https://exercism.org/tracks/go/exercises/anagram/edit" },
        { id: 5, index: 4, url: "https://example.com/" }
    ];

    assert.equal(
        vm.runInContext(
            "findRightCodingTab(tabs, tabs[0], 'Exercism').id",
            vm.createContext({ ...context, tabs })
        ),
        3
    );
});

function loadExercismOverviewScript(documentOverrides = {}, chromeOverrides = {}) {
    const chrome = {
        storage: {
            local: { get: async () => ({}), set: async () => {} },
            onChanged: { addListener: () => {} }
        },
        ...chromeOverrides
    };
    const document = {
        documentElement: null,
        addEventListener: () => {},
        querySelector: () => null,
        ...documentOverrides
    };
    const sessionStorage = {
        entries: new Map(),
        getItem(key) {
            return this.entries.has(key) ? this.entries.get(key) : null;
        },
        setItem(key, value) {
            this.entries.set(key, String(value));
        }
    };
    const context = vm.createContext({
        chrome,
        console,
        document,
        sessionStorage,
        location: { href: "", assign: () => {} }
    });

    for (const file of [
        "worker/exercism/overview/open_exercise_in_editor.js"
    ]) {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT_DIR, file), "utf8"),
            context,
            { filename: file }
        );
    }

    return context;
}

test("opens the editor for a new or unfinished exercise without a mark-complete control", () => {
    const context = loadExercismOverviewScript();
    const target = (url, state) => vm.runInContext(
        `resolveExercismExerciseEditorRedirectTarget(${JSON.stringify(url)}, ${JSON.stringify(state)})`,
        context
    );
    const overview = "https://exercism.org/tracks/rust/exercises/anagram";
    const editorUrl = overview + "/edit";
    const available = { status: "available", editorEnabled: true };
    const inProgress = extra => ({
        status: "started",
        editorEnabled: true,
        inProgress: true,
        ...extra
    });

    // Never started: Exercism opens the editor by itself, the redirect mirrors it.
    assert.equal(target(overview, available), editorUrl);
    assert.equal(target(overview + "?foo=1", available), editorUrl);
    assert.equal(target(overview + "/", available), editorUrl);

    // Started and the overview page has nothing left to confirm.
    assert.equal(target(overview, inProgress({})), editorUrl);
    assert.equal(
        target("https://exercism.org/tracks/rust/exercises/clock", inProgress({
            status: "iterated"
        })),
        ""
    );

    // Completed exercises keep their overview page.
    assert.equal(target(overview, { status: "completed", editorEnabled: true }), "");
    assert.equal(
        target(overview, {
            status: "completed",
            editorEnabled: true,
            inProgress: false
        }),
        ""
    );

    // The editor is only entered when Exercism offers it at all.
    assert.equal(target(overview, { status: "available", editorEnabled: false }), "");
    assert.equal(target(overview, null), "");

    // Editor pages and other sites are never redirected.
    assert.equal(target(editorUrl, available), "");
    assert.equal(
        target("https://leetcode.com/problems/two-sum/", available),
        ""
    );

    assert.equal(
        target(overview, {
            status: "iterated",
            editorEnabled: true,
            inProgress: true,
            solved: true,
            markCompleteAvailable: false
        }),
        ""
    );
});

test("reads the overview status badge without owning mark-complete controls", () => {
    const badge = (text, visible = true) => ({
        textContent: text,
        innerText: text,
        offsetWidth: visible ? 40 : 0,
        offsetHeight: visible ? 20 : 0
    });
    const overviewDocument = badges => ({
        querySelectorAll: () => badges
    });

    const started = loadExercismOverviewScript(overviewDocument(
        [badge("In progress")]
    ));

    assert.equal(
        vm.runInContext("isExercismOverviewMarkedInProgress()", started),
        true
    );
    // Hidden, unrelated and oversized matches must not count as "in progress".
    const ignored = loadExercismOverviewScript(overviewDocument(
        [
            badge("In progress", false),
            badge("Completed"),
            badge("In progress " + "x".repeat(60))
        ]
    ));

    assert.equal(
        vm.runInContext("isExercismOverviewMarkedInProgress()", ignored),
        false
    );
    // The state consumed by the redirect contains no mark-complete field.
    const badges = [badge("In progress")];
    const combined = loadExercismOverviewScript(
        overviewDocument(badges)
    );
    const state = () => vm.runInContext(
        "JSON.stringify(readExercismOverviewExerciseState())",
        combined
    );

    assert.equal(state(), JSON.stringify({
        status: "",
        editorEnabled: true,
        solved: false,
        inProgress: true
    }));
});

test("recognizes the explicit Exercise Solved overview heading", () => {
    const solved = loadExercismOverviewScript({
        querySelectorAll: selector => selector === "button"
            ? []
            : [{
                innerText: "Exercise Solved",
                offsetWidth: 100,
                offsetHeight: 30
            }]
    });

    assert.equal(
        vm.runInContext("isExercismOverviewSolved()", solved),
        true
    );
});

test("completed in-progress pages stay on overview when the control renders during the first check", async () => {
    let resolveStorage;
    const storageRead = new Promise(resolve => {
        resolveStorage = resolve;
    });
    const chrome = {
        storage: {
            local: {
                get: async () => {
                    await storageRead;
                    return {};
                }
            },
            onChanged: { addListener: () => {} }
        }
    };
    const buttons = [];
    const document = {
        documentElement: null,
        addEventListener: () => {},
        querySelector: () => ({
            getAttribute: () => JSON.stringify({
                status: "iterated",
                editor_enabled: true
            })
        }),
        querySelectorAll: selector => selector === "button"
            ? buttons
            : []
    };
    const context = loadExercismOverviewScript(document, chrome);
    vm.runInContext(
        "location.href = 'https://exercism.org/tracks/go/exercises/example'; openExercismEditorWhenOverviewHasNothingToConfirm()",
        context
    );
    buttons.push({
        innerText: "Mark as complete",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false
    });
    vm.runInContext(
        "openExercismEditorWhenOverviewHasNothingToConfirm()",
        context
    );
    resolveStorage();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(vm.runInContext("sessionStorage.entries.size", context), 0);
});

test("reads the exercise status from React data and rejects unusable payloads", () => {
    const context = loadExercismOverviewScript();
    const parse = raw => vm.runInContext(
        `parseExercismOpenEditorButtonData(${JSON.stringify(raw)})`,
        context
    );

    assert.equal(
        JSON.stringify(parse('{"status":"available","editor_enabled":true}')),
        JSON.stringify({ status: "available", editorEnabled: true })
    );
    assert.equal(
        JSON.stringify(parse(
            '{&quot;status&quot;:&quot;started&quot;,&quot;editor_enabled&quot;:true}'
        )),
        JSON.stringify({ status: "started", editorEnabled: true })
    );
    assert.equal(parse(""), null);
    assert.equal(parse("not json"), null);
    assert.equal(parse('{"command":"exercism download"}'), null);
});

test("remembers a redirect so one exercise cannot loop in a tab session", () => {
    const context = loadExercismOverviewScript();
    const path = "/tracks/rust/exercises/anagram/edit";

    assert.equal(
        vm.runInContext(`editorRedirectAlreadyIssued("${path}")`, context),
        false
    );

    vm.runInContext(`rememberEditorRedirect("${path}")`, context);

    assert.equal(
        vm.runInContext(`editorRedirectAlreadyIssued("${path}")`, context),
        true
    );
    assert.equal(
        vm.runInContext(
            'editorRedirectAlreadyIssued("/tracks/rust/exercises/clock/edit")',
            context
        ),
        false
    );
});

test("completes the Exercism overview condition-to-modal-to-result flow", async () => {
    const worker = loadWorker();
    let status = "iterated";
    let markCompleteAvailable = false;
    let confirmationModalVisible = false;
    let completionResultVisible = false;
    let markClicks = 0;
    let confirmClicks = 0;
    let overviewMutationCallback;
    const messages = [];
    const events = [];
    const reloadedTabIds = [];
    const removedTabIds = worker.removedTabs;
    const markButton = {
        innerText: "Mark as complete",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false,
        click: () => {
            markClicks += 1;
            events.push("mark-clicked");
            confirmationModalVisible = true;
            events.push("confirmation-modal-opened");
        }
    };
    const confirmButton = {
        innerText: "Confirm",
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false,
        click: () => {
            confirmClicks += 1;
            events.push("confirm-clicked");
            confirmationModalVisible = false;
            setTimeout(() => {
                completionResultVisible = true;
                events.push("completion-result-output");
            }, 250);
        }
    };
    worker.document = {
        querySelector: () => ({
            getAttribute: () => JSON.stringify({ status })
        }),
        querySelectorAll: selector => {
            if (selector === "h1, h2, h3, h4") {
                return [{
                    innerText: "Exercise Solved",
                    offsetWidth: 100,
                    offsetHeight: 30
                }];
            }

            if (selector === "button") {
                if (confirmationModalVisible) return [confirmButton];
                return markCompleteAvailable ? [markButton] : [];
            }

            if (selector === "dialog, [role='dialog']") {
                return completionResultVisible
                    ? [{
                        innerText: "You've completed Hello World",
                        offsetWidth: 600,
                        offsetHeight: 400
                    }]
                    : [];
            }

            return [];
        }
    };
    worker.chrome.storage = {
        local: { get: async () => ({}) }
    };
    worker.chrome.scripting.executeScript = async ({ func, args }) => [{
        result: await func(...args)
    }];
    worker.chrome.tabs.query = async () => [
        { id: 1, url: "https://exercism.org/tracks/sqlite/concepts" },
        { id: 2, url: "https://exercism.org/tracks/rust/concepts" },
        { id: 3, url: "https://exercism.org/tracks/sqlite/concepts/?view=all" }
    ];
    worker.chrome.tabs.reload = async tabId => {
        reloadedTabIds.push(tabId);
        events.push(completionResultVisible
            ? `concepts-reloaded-after-result-${tabId}`
            : `concepts-reloaded-before-result-${tabId}`);
    };
    worker.chrome.tabs.remove = async tabId => {
        removedTabIds.push(tabId);
        events.push(`overview-closed-${tabId}`);
    };

    const documentListeners = new Map();
    const pageDocument = {
        documentElement: {},
        addEventListener: (type, listener) => documentListeners.set(type, listener),
        querySelectorAll: selector => selector === "button" && markCompleteAvailable
            ? [markButton]
            : []
    };
    const pageContext = vm.createContext({
        chrome: {
            storage: { local: { get: async () => ({}) } },
            runtime: {
                sendMessage: message => {
                    messages.push(message);
                    for (const listener of worker.messageListeners) {
                        listener(message, {
                            tab: {
                                id: 10,
                                url: "https://exercism.org/tracks/sqlite/exercises/hello-world"
                            }
                        }, () => {});
                    }
                }
            }
        },
        document: pageDocument,
        location: {
            href: "https://exercism.org/tracks/sqlite/exercises/hello-world"
        },
        MutationObserver: class {
            constructor(callback) {
                overviewMutationCallback = callback;
            }
            observe() {}
        }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "overview", "auto_mark_exercise_complete.js"),
            "utf8"
        ),
        pageContext
    );

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(messages, []);

    markCompleteAvailable = true;
    overviewMutationCallback();

    const deadline = Date.now() + 1000;
    while (removedTabIds.length < 1 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.equal(status, "iterated");
    assert.equal(completionResultVisible, true);
    assert.equal(markClicks, 1);
    assert.equal(confirmClicks, 1);
    assert.deepEqual(
        messages.map(message => message.type),
        ["exercism-mark-complete"]
    );
    assert.deepEqual(reloadedTabIds, [1, 3]);
    assert.deepEqual(removedTabIds, [10]);
    assert.ok(
        events.indexOf("completion-result-output") <
            events.indexOf("concepts-reloaded-after-result-1"),
        "the completion result must be visible before concepts refresh"
    );
    assert.ok(
        events.indexOf("concepts-reloaded-after-result-3") <
            events.indexOf("overview-closed-10"),
        "the overview must close after the concepts refresh"
    );
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
            path.join(ROOT_DIR, "worker", "exercism", "concepts_and_exercises", "preserve_track_list_scroll_position.js"),
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
