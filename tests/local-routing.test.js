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

function loadWorker({ tabs = [] } = {}) {
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} } },
        scripting: { executeScript: async () => [{ result: true }] },
        tabs: { query: async () => tabs, update: async () => {} }
    };
    const context = vm.createContext({ chrome, console, performance, setTimeout });
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

function loadExercismOverviewScript(documentOverrides = {}) {
    const chrome = {
        storage: {
            local: { get: async () => ({}), set: async () => {} },
            onChanged: { addListener: () => {} }
        }
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
        markCompleteAvailable: false,
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
        "https://exercism.org/tracks/rust/exercises/clock/edit"
    );

    // Started and waiting for a completion confirmation: the mark-complete chain
    // owns the overview page, so the redirect stays out of its way.
    assert.equal(
        target(overview, inProgress({ markCompleteAvailable: true })),
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
});

test("reads the status badge, the mark-complete control, and combines them", () => {
    const badge = (text, visible = true) => ({
        textContent: text,
        innerText: text,
        offsetWidth: visible ? 40 : 0,
        offsetHeight: visible ? 20 : 0
    });
    const markCompleteButton = (text, extra = {}) => ({
        textContent: text,
        innerText: text,
        offsetWidth: 100,
        offsetHeight: 30,
        disabled: false,
        ...extra
    });
    const overviewDocument = (badges, buttons) => ({
        querySelectorAll: selector => (selector === "button" ? buttons : badges)
    });

    const started = loadExercismOverviewScript(overviewDocument(
        [badge("In progress")],
        []
    ));

    assert.equal(
        vm.runInContext("isExercismOverviewMarkedInProgress()", started),
        true
    );
    assert.equal(
        vm.runInContext("isExercismMarkCompleteControlAvailable()", started),
        false
    );

    // Hidden, unrelated and oversized matches must not count as "in progress",
    // and a disabled control is not a completion offer.
    const ignored = loadExercismOverviewScript(overviewDocument(
        [
            badge("In progress", false),
            badge("Completed"),
            badge("In progress " + "x".repeat(60))
        ],
        [markCompleteButton("Mark as complete", { disabled: true })]
    ));

    assert.equal(
        vm.runInContext("isExercismOverviewMarkedInProgress()", ignored),
        false
    );
    assert.equal(
        vm.runInContext("isExercismMarkCompleteControlAvailable()", ignored),
        false
    );

    // The combined state is what the redirect consumes, and it remembers that
    // the control appeared so a click cannot send the user away mid-confirmation.
    const badges = [badge("In progress")];
    const buttons = [markCompleteButton("Mark as complete")];
    const combined = loadExercismOverviewScript(
        overviewDocument(badges, buttons)
    );
    const state = () => vm.runInContext(
        "JSON.stringify(readExercismOverviewExerciseState())",
        combined
    );

    assert.equal(state(), JSON.stringify({
        status: "",
        editorEnabled: true,
        inProgress: true,
        markCompleteAvailable: true
    }));

    buttons.length = 0; // the click removed the control for the confirmation

    assert.equal(state(), JSON.stringify({
        status: "",
        editorEnabled: true,
        inProgress: true,
        markCompleteAvailable: true
    }));
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
