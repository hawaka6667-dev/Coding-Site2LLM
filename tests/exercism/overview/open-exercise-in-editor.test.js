/* @machine
file: tests/exercism/overview/open-exercise-in-editor.test.js
role: verify Exercism overview editor navigation
run: npm run test:routing
*/

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadExercismOverviewScript } = require("../../worker-test-harness.js");

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
