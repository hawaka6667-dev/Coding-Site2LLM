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
            path.join(ROOT_DIR, "worker", "exercism", "auto_mark_exercise_complete.js"),
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

function loadWorker({ tabs = [] } = {}) {
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} } },
        scripting: { executeScript: async () => [{ result: true }] },
        tabs: { query: async () => tabs, update: async () => {} }
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
        "worker/exercism/open_exercise_in_editor.js"
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

test("refreshes only matching track concepts tabs after confirmed completion", async () => {
    const context = loadWorker();
    const reloadedTabIds = [];
    context.getPlatform = () => ({ markComplete: async () => true });
    context.chrome.storage = {
        local: { get: async () => ({}) }
    };
    context.chrome.tabs.query = async filter => {
        assert.equal(filter.url, "https://exercism.org/tracks/*/concepts*");
        return [
            { id: 1, url: "https://exercism.org/tracks/go/concepts" },
            { id: 2, url: "https://exercism.org/tracks/rust/concepts" },
            { id: 3, url: "https://exercism.org/tracks/go/concepts/?view=all" },
            { id: 4, url: "https://exercism.org/tracks/go/concepts-extra" },
            { id: 5, url: "https://example.com/tracks/go/concepts" }
        ];
    };
    context.chrome.tabs.reload = async tabId => {
        reloadedTabIds.push(tabId);
    };

    const completed = await context.markCompleteAndRefreshConcepts(
        20,
        "https://exercism.org/tracks/go/exercises/lasagna-master"
    );

    assert.equal(completed, true);
    assert.deepEqual(reloadedTabIds, [1, 3]);
});

test("does not refresh concepts when completion is unconfirmed or the option is off", async () => {
    const context = loadWorker();
    let queriedTabs = false;
    context.getPlatform = () => ({ markComplete: async () => false });
    context.chrome.storage = {
        local: { get: async () => ({}) }
    };
    context.chrome.tabs.query = async () => {
        queriedTabs = true;
        return [];
    };

    assert.equal(await context.markCompleteAndRefreshConcepts(
        20,
        "https://exercism.org/tracks/go/exercises/lasagna-master"
    ), false);
    assert.equal(queriedTabs, false);

    context.getPlatform = () => ({ markComplete: async () => true });
    context.chrome.storage.local.get = async () => ({
        exercismRefreshConceptsAfterComplete: false
    });
    assert.equal(await context.markCompleteAndRefreshConcepts(
        20,
        "https://exercism.org/tracks/go/exercises/lasagna-master"
    ), true);
    assert.equal(queriedTabs, false);
});

test("restores and saves the Exercism concepts page scroll position", () => {
    const storage = new Map([
        ["codingSite2LlmExercismConceptsScroll:/tracks/go/concepts", "640"]
    ]);
    const windowListeners = new Map();
    const documentListeners = new Map();
    const window = {
        scrollY: 0,
        addEventListener: (type, listener) => windowListeners.set(type, listener),
        scrollTo: (_left, top) => {
            window.scrollY = top;
        }
    };
    const context = vm.createContext({
        document: {
            addEventListener: (type, listener) => documentListeners.set(type, listener)
        },
        location: { pathname: "/tracks/go/concepts" },
        requestAnimationFrame: callback => callback(),
        sessionStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value))
        },
        window
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "preserve_concepts_scroll_position.js"),
            "utf8"
        ),
        context
    );

    assert.equal(window.scrollY, 640);
    window.scrollY = 825;
    windowListeners.get("scroll")();
    assert.equal(
        storage.get("codingSite2LlmExercismConceptsScroll:/tracks/go/concepts"),
        "825"
    );
    assert.equal(typeof windowListeners.get("pagehide"), "function");
    assert.equal(typeof documentListeners.get("turbo:load"), "function");
});
