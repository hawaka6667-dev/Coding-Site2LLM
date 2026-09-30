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

const PROJECT_ROOT = path.join(__dirname, "..");
const SOURCE_ROOT = path.join(PROJECT_ROOT, "src");
const ROOT_DIR = path.join(PROJECT_ROOT, "dist");

function listFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    });
}

function assertLocalHtmlResourcesExist(htmlFile) {
    const html = fs.readFileSync(htmlFile, "utf8");
    const references = html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi);

    for (const [, , reference] of references) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) {
            continue;
        }

        const resourcePath = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
        const resolvedPath = reference.startsWith("/")
            ? path.resolve(ROOT_DIR, `.${resourcePath}`)
            : path.resolve(path.dirname(htmlFile), resourcePath);
        const relativePath = path.relative(ROOT_DIR, resolvedPath);

        assert.ok(
            relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath),
            `HTML resource escapes extension package: ${reference} in ${path.relative(ROOT_DIR, htmlFile)}`
        );
        assert.equal(
            fs.existsSync(resolvedPath),
            true,
            `Missing HTML resource: ${reference} in ${path.relative(ROOT_DIR, htmlFile)}`
        );
    }
}

function readManifest() {
    assert.equal(fs.existsSync(path.join(SOURCE_ROOT, "icons", "icon-preview.html")), true);
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, ".build", "build-extension.js")), true);
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, "scripts")), false);
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, "tools")), false);
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));
}

test("defaults the toolbar icon theme to Warm Ivory", () => {
    const options = fs.readFileSync(path.join(SOURCE_ROOT, "options", "options.js"), "utf8");
    const iconThemeWorker = fs.readFileSync(
        path.join(SOURCE_ROOT, "worker", "manage_icon_theme.ts"),
        "utf8"
    );

    assert.match(options, /iconTheme: "warm-ivory"/);
    assert.match(iconThemeWorker, /DEFAULT_ICON_THEME = "warm-ivory"/);
});

test("keeps the extension runtime isolated from repository tooling", () => {
    const manifest = readManifest();
    const runtimeFiles = [
        manifest.background.service_worker,
        manifest.options_ui.page,
        manifest.action.default_popup,
        ...Object.values(manifest.icons),
        ...Object.values(manifest.action.default_icon),
        ...manifest.content_scripts.flatMap(script => script.js)
    ];

    assert.equal(fs.existsSync(path.join(ROOT_DIR, "../manifest.json")), false);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, "icons", "icon-preview.html")), false);
    for (const file of runtimeFiles) {
        assert.equal(fs.existsSync(path.join(ROOT_DIR, file)), true, `Missing extension file: ${file}`);
    }
});

test("injects the shortcut bridge on HTTP(S) pages exactly once", () => {
    const manifest = readManifest();
    const shortcutScripts = manifest.content_scripts.filter(script =>
        script.js.includes("worker/keyboard_shortcuts.js")
    );

    assert.equal(shortcutScripts.length, 1);
    assert.ok(shortcutScripts[0].matches.includes("*://*/*"));
    assert.ok(manifest.host_permissions.includes("*://*/*"));
    assert.ok(!shortcutScripts[0].js.includes("worker/llm_copy_tracker.js"));
});

test("keeps local resources referenced by extension HTML in the package", () => {
    const htmlFiles = listFiles(ROOT_DIR).filter(file => file.endsWith(".html"));

    assert.ok(htmlFiles.length > 0);
    for (const htmlFile of htmlFiles) {
        assertLocalHtmlResourcesExist(htmlFile);
    }
});

test("keeps TypeScript output in dist instead of beside source files", () => {
    const sourceFiles = listFiles(SOURCE_ROOT);
    const typescriptFiles = sourceFiles.filter(file =>
        file.endsWith(".ts") && !file.endsWith(".d.ts")
    );

    assert.ok(typescriptFiles.length > 0);
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, "extension")), false);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, "background.ts")), false);

    for (const sourceFile of typescriptFiles) {
        const relativeSource = path.relative(SOURCE_ROOT, sourceFile);
        const javascriptFile = relativeSource.replace(/\.ts$/, ".js");

        assert.equal(
            fs.existsSync(path.join(SOURCE_ROOT, javascriptFile)),
            false,
            `Generated JavaScript must not be beside ${relativeSource}`
        );
        assert.equal(
            fs.existsSync(path.join(ROOT_DIR, javascriptFile)),
            true,
            `Missing compiled output for ${relativeSource}`
        );
    }
});

test("keeps extension commands and content scripts registered", () => {
    const manifest = readManifest();

    assert.ok(manifest.permissions.includes("webNavigation"));
    assert.equal(manifest.commands, undefined);
    assert.deepEqual(manifest.options_ui, {
        page: "options/options.html",
        open_in_tab: true
    });
    assert.deepEqual(manifest.content_scripts[0].js, [
        "worker/exercism/edit/content.js",
        "worker/exercism/edit/auto_submit_after_manual_run.js",
        "worker/exercism/edit/manage_submitted_exercism_overview_window.js",
        "worker/exercism/edit/continue_after_exercism_modals.js",
        "worker/exercism/overview/auto_mark_exercise_complete.js"
    ]);
    assert.deepEqual(
        manifest.content_scripts[1].js,
        [
            "worker/exercism/overview/open_exercise_in_editor.js",
            "worker/exercism/overview/auto_mark_exercise_complete.js",
            "worker/exercism/overview/dismiss_exercism_overview_closable_dialogs.js",
            "worker/exercism/edit/manage_submitted_exercism_overview_window.js"
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
            label: "Exercism pl Track",
            url: "https://exercism.org/tracks"
        },
        {
            id: "regexone",
            label: "RegexOne",
            url: "https://regexone.com/"
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
    const editAdapterSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "adapters", "exercism_edit_adapter.js"),
        "utf8"
    );
    const overviewAdapterSource = fs.readFileSync(
        path.join(ROOT_DIR, "worker", "adapters", "exercism_overview_adapter.js"),
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
    const testAndSubmit = editAdapterSource.slice(
        editAdapterSource.indexOf("async testAndSubmit(tabId"),
        editAdapterSource.indexOf("async getContext(tabId")
    );

    assert.match(contentSource, /exercism-test-submit/);
    assert.match(overviewAdapterSource, /completeExercismExercise\(tabId\)/);
    assert.doesNotMatch(testAndSubmit, /markComplete|completeExercismExercise/);

    // The overview mark-complete script asks for the chain by message; both
    // ends must keep spelling that same type.
    const markCompleteMessageType = /"exercism-mark-complete"/;
    assert.match(markCompleteSource, markCompleteMessageType);
    assert.match(workflowSource, markCompleteMessageType);
});

test("continues past Exercism's automated-feedback check without waiting", () => {
    const clicked = [];
    const dialog = {
        tagName: "DIALOG",
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: 400, height: 200 })
    };
    const makeButton = label => ({
        innerText: label,
        parentElement: dialog,
        disabled: false,
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: 180, height: 32 }),
        click: () => clicked.push(label)
    });
    const buttons = [
        makeButton("Continue without waiting"),
        makeButton("Not now")
    ];
    dialog.querySelectorAll = () => buttons;
    const document = {
        documentElement: {},
        querySelectorAll: () => [dialog],
        addEventListener: () => {}
    };
    const context = vm.createContext({
        document,
        MutationObserver: class {
            observe() {}
        }
    });
    const source = fs.readFileSync(
        path.join(
            ROOT_DIR,
            "worker",
            "exercism",
            "edit",
            "continue_after_exercism_modals.js"
        ),
        "utf8"
    );

    vm.runInContext(source, context);

    assert.deepEqual(clicked, ["Continue without waiting"]);
});

test("registers shared list scroll restoration on Exercism track list pages", () => {
    const trackListScript = readManifest().content_scripts.find(script =>
        script.js.includes(
            "worker/exercism/preserve_track_list_scroll_position.js"
        )
    );

    assert.deepEqual(trackListScript.matches, [
        "https://exercism.org/tracks/*/concepts*",
        "https://exercism.org/tracks/*/exercises*"
    ]);
    assert.equal(trackListScript.run_at, "document_start");
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
