/* @machine
file: tests/global-extension-contract.test.js
role: verify manifest and extension wiring contracts
run: npm run test:contracts
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");

function readManifest() {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));
}

test("keeps extension commands and content scripts registered", () => {
    const manifest = readManifest();

    assert.equal(manifest.commands, undefined);
    assert.deepEqual(manifest.options_ui, {
        page: "options/options.html",
        open_in_tab: true
    });
    assert.deepEqual(manifest.content_scripts[0].js, [
        "worker/exercism/edit/content.js",
        "worker/exercism/edit/auto_submit_after_manual_run.js"
    ]);
    assert.deepEqual(
        manifest.content_scripts[1].js,
        [
            "worker/exercism/overview/open_exercise_in_editor.js",
            "worker/exercism/overview/auto_mark_exercise_complete.js"
        ]
    );
    assert.equal(manifest.commands?.["exercism-test-submit"], undefined);
});

test("keeps the general options page wired to implemented Exercism features", () => {
    const optionsHtml = fs.readFileSync(
        path.join(ROOT_DIR, "options", "options.html"),
        "utf8"
    );
    const optionsSource = fs.readFileSync(
        path.join(ROOT_DIR, "options", "options.js"),
        "utf8"
    );

    for (const key of [
        "exercismOpenNewExerciseInEditor",
        "exercismAutoSubmitAfterManualRun",
        "exercismAutoMarkComplete",
        "exercismRefreshConceptsAfterComplete"
    ]) {
        assert.match(optionsHtml, new RegExp(`data-setting="${key}"`));
        assert.match(optionsSource, new RegExp(key));
    }

    assert.match(optionsHtml, /<section aria-labelledby="exercism-heading">/);
    assert.match(optionsHtml, /<section aria-labelledby="llm-heading">/);
    assert.match(optionsHtml, /id="shortcut-send-context"/);
    assert.match(optionsHtml, /id="shortcut-smart-return"/);
    assert.match(optionsSource, /codingSite2LlmShortcuts/);
    assert.match(optionsSource, /keydown/);
    assert.match(optionsSource, /send-context/);
    assert.match(optionsSource, /smart-return/);
    assert.match(optionsSource, /DEFAULT_SHORTCUTS/);
    assert.match(optionsHtml, /data-icon-theme/);
    assert.match(optionsSource, /iconTheme/);
    assert.match(fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"), /manage_icon_theme\.js/);
});

test("keeps the popup toggle wired to the Exercism redirect setting", () => {
    const manifest = readManifest();
    const popupPath = manifest.action.default_popup;
    const popupHtml = fs.readFileSync(path.join(ROOT_DIR, popupPath), "utf8");
    const popupSource = fs.readFileSync(
        path.join(ROOT_DIR, path.dirname(popupPath), "popup.js"),
        "utf8"
    );
    const redirectSource = fs.readFileSync(
        path.join(
            ROOT_DIR,
            "worker",
            "exercism",
            "overview",
            "open_exercise_in_editor.js"
        ),
        "utf8"
    );

    assert.equal(manifest.permissions.includes("storage"), true);
    // The popup lives in its own folder instead of flattening the project root.
    assert.equal(popupPath, "popup/popup.html");
    assert.match(popupHtml, /<script src="popup\.js">/);
    assert.match(popupHtml, /shortcut: Alt\+Q/);

    // The setting is declared next to the behaviour it controls; the popup must
    // read and write that exact key.
    const keyLiteral = /"exercismOpenNewExerciseInEditor"/;
    assert.match(redirectSource, keyLiteral);
    assert.match(popupSource, keyLiteral);
    assert.match(
        redirectSource,
        /EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_DEFAULT = true/
    );
});

test("keeps daily-practice destinations in an extensible popup provider list", () => {
    const popupHtml = fs.readFileSync(
        path.join(ROOT_DIR, "popup", "popup.html"),
        "utf8"
    );
    const popupSource = fs.readFileSync(
        path.join(ROOT_DIR, "popup", "popup.js"),
        "utf8"
    );
    const providerSource = fs.readFileSync(
        path.join(ROOT_DIR, "popup", "daily_practice_providers.js"),
        "utf8"
    );
    const fixedDate = class extends Date {
        constructor(...args) {
            super(...(args.length ? args : ["2026-09-24T12:00:00.000Z"]));
        }
    };
    const context = { Date: fixedDate };

    vm.runInNewContext(
        `${providerSource}\nglobalThis.providers = DAILY_PRACTICE_PROVIDERS;`,
        context
    );

    const providers = Array.from(context.providers, provider => ({
        id: provider.id,
        label: provider.label,
        url: provider.getUrl()
    }));

    assert.match(popupHtml, /aria-labelledby="daily-practice-heading"/);
    assert.match(popupHtml, /id="daily-practice-links"/);
    assert.match(popupHtml, /<script src="daily_practice_providers\.js"><\/script>/);
    assert.match(popupHtml, /\.daily-practice-button/);
    assert.match(popupSource, /chrome\.tabs\.create\(\{ url: provider\.getUrl\(\) \}\)/);
    assert.match(popupSource, /for \(const provider of getDailyPracticeProviders\(\)\)/);
    assert.deepEqual(providers, [
        {
            id: "leetcode",
            label: "Leet Daily📅",                     //test
            url: "https://leetcode.com/problemset/?envType=daily-question&envId=2026-09-24"
        },
        {
            id: "codewars",
            label: "Codewars",
            url: "https://www.codewars.com/dashboard"
        },
        {
            id: "neetcode-roadmap",
            label: "Neet Roadmap",
            url: "https://neetcode.io/roadmap"
        },
        {
            id: "exercism-tracks",
            label: "Exercism language Track",
            url: "https://exercism.org/tracks"
        }
    ]);
});

test("keeps the popup LLM provider setting wired to the worker", () => {
    const manifest = readManifest();
    const popupPath = manifest.action.default_popup;
    const popupHtml = fs.readFileSync(path.join(ROOT_DIR, popupPath), "utf8");
    const popupSource = fs.readFileSync(
        path.join(ROOT_DIR, path.dirname(popupPath), "popup.js"),
        "utf8"
    );
    const providerSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "configure_supported_coding_sites_and_llm_providers.js"),
        "utf8"
    );
    const workflowSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "run_coding_context_to_llm_workflow.js"),
        "utf8"
    );

    assert.match(popupHtml, /id="llm-provider"/);
    assert.match(popupHtml, /<option value="DeepSeek">DeepSeek<\/option>/);
    assert.match(popupSource, /"selectedLlmProvider"/);
    assert.match(popupSource, /codingSite2LlmShortcuts/);
    assert.match(popupSource, /DEFAULT_LLM_PROVIDER = "DeepSeek"/);
    assert.match(workflowSource, /"selectedLlmProvider"/);

    for (const provider of ["DeepSeek", "ChatGPT", "Claude", "Gemini", "DeepAI"]) {
        assert.match(providerSource, new RegExp(`name: "${provider}"`));
        assert.match(providerSource, new RegExp(`url: "https://`));
    }

    assert.equal(
        manifest.content_scripts.some(script =>
            script.js.includes("worker/llm_copy_tracker.js")
        ),
        true
    );
});

test("keeps mark-complete separate from Ctrl+Enter submission", () => {
    const contentSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "exercism", "edit", "content.js"),
        "utf8"
    );
    const adapterSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "extract_coding_site_context_with_site_adapters.js"),
        "utf8"
    );
    const markCompleteSource = fs.readFileSync(
        path.join(
            ROOT_DIR,
            "worker",
            "exercism",
            "overview",
            "auto_mark_exercise_complete.js"
        ),
        "utf8"
    );
    const workflowSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "run_coding_context_to_llm_workflow.js"),
        "utf8"
    );
    const testAndSubmit = adapterSource.slice(
        adapterSource.indexOf("async testAndSubmit(tabId)"),
        adapterSource.indexOf("async getContext(tabId)")
    );

    assert.match(contentSource, /exercism-test-submit/);
    assert.match(adapterSource, /completeExercismExercise\(tabId\)/);
    assert.doesNotMatch(testAndSubmit, /markComplete|completeExercismExercise/);

    // The overview mark-complete script asks for the chain by message; both
    // ends must keep spelling that same type.
    const markCompleteMessageType = /"exercism-mark-complete"/;
    assert.match(markCompleteSource, markCompleteMessageType);
    assert.match(workflowSource, markCompleteMessageType);
});

test("registers the concepts scroll-restoration script on Exercism concepts pages", () => {
    const conceptsScript = readManifest().content_scripts.find(script =>
        script.js.includes(
            "worker/exercism/concepts/preserve_concepts_scroll_position.js"
        )
    );

    assert.deepEqual(conceptsScript.matches, [
        "https://exercism.org/tracks/*/concepts*"
    ]);
    assert.equal(conceptsScript.run_at, "document_start");
});

test("keeps the extension icon assets registered", () => {
    const manifest = readManifest();

    assert.deepEqual(manifest.action.default_icon, {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
    });
    for (const iconPath of Object.values(manifest.action.default_icon)) {
        assert.equal(fs.existsSync(path.join(ROOT_DIR, iconPath)), true);
    }
});
