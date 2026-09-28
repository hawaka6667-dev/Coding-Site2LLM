/* @machine
file: worker/exercism/overview/open_exercise_in_editor.js
role: redirect overview to editor when no confirmation remains
state: available|started|iterated|completed|unknown
redirect: available or started -> /edit
stay: iterated | completed | unknown
guard: sessionStorage per tab and exercise
events: turbo:load | turbo:render | MutationObserver
setting: exercismOpenNewExerciseInEditor
*/

const EXERCISM_EXERCISE_OVERVIEW_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

const EXERCISM_OPEN_EDITOR_BUTTON_SELECTOR =
    '[data-react-id="student-open-editor-button"]';

/* Status badge: small, text-only status containers. */
const EXERCISM_STATUS_BADGE_SELECTORS = [
    '[class*="status"]',
    '[class*="badge"]',
    '[class*="pill"]',
    '[class*="tag"]'
];
const EXERCISM_IN_PROGRESS_TEXT_PATTERN = /\bin[-\s]?progress\b/i;

// A status badge is a couple of words; the length cap keeps a larger wrapper
// that happens to match the selectors above out of the decision.
const EXERCISM_STATUS_BADGE_MAX_TEXT_LENGTH = 40;

// React statuses that mean "started, not finished". "completed" is a terminal
// state and is deliberately absent.
const EXERCISM_IN_PROGRESS_STATUSES = [
    "started",
    "iterated",
    "in_progress",
    "in-progress"
];

const EXERCISM_SOLVED_HEADING_PATTERN = /^exercise solved$/i;

const EXERCISM_EDITOR_REDIRECT_GUARD_PREFIX =
    "codingSite2Llm.exercismOpenNewExerciseInEditor:";

/* Setting: keep this key in sync with popup.js. */
const EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY =
    "exercismOpenNewExerciseInEditor";
const EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_DEFAULT = true;

// Cached per page; storage.onChanged refreshes it, so flipping the popup toggle
// applies to an already open page instead of waiting for a reload.
let openNewExerciseInEditorEnabled = null;

async function isExercismOpenNewExerciseInEditorEnabled() {
    if (openNewExerciseInEditorEnabled === null) {
        try {
            const stored = await chrome.storage.local.get(
                EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY
            );
            const value = stored?.[EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY];

            openNewExerciseInEditorEnabled =
                typeof value === "boolean"
                    ? value
                    : EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_DEFAULT;
        } catch (error) {
            console.warn(
                "[Exercism] Could not read " +
                EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY +
                "; using its default.",
                error
            );
            openNewExerciseInEditorEnabled =
                EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_DEFAULT;
        }
    }

    return openNewExerciseInEditorEnabled;
}

chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
        return;
    }

    const change = changes?.[EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY];

    if (change && typeof change.newValue === "boolean") {
        openNewExerciseInEditorEnabled = change.newValue;
    }
});

function parseExercismOpenEditorButtonData(rawData) {
    if (typeof rawData !== "string" || !rawData.trim()) {
        return null;
    }

    try {
        // React data is HTML-escaped when it is serialized into the page.
        const data = JSON.parse(rawData.replace(/&quot;/g, '"'));
        const status = typeof data?.status === "string" ? data.status : "";

        if (!status) {
            return null;
        }

        return {
            status,
            editorEnabled: data.editor_enabled !== false
        };
    } catch (_) {
        return null;
    }
}

function readExercismOpenEditorButtonState() {
    const node = document.querySelector(EXERCISM_OPEN_EDITOR_BUTTON_SELECTOR);
    const state = parseExercismOpenEditorButtonData(
        node?.getAttribute("data-react-data") || ""
    );

    if (state) {
        return state;
    }

    // Fallback for a renamed React node: the action-box copy of an exercise
    // that has not been started yet. The button label cannot be used here.
    const actionBox = document.querySelector(".action-box.pending");

    if (!actionBox || !actionBox.querySelector('a.editor-btn[href$="/edit"]')) {
        return null;
    }

    return /available for you to start/i.test(actionBox.innerText || "")
        ? { status: "available", editorEnabled: true }
        : null;
}

function buildExercismEditorUrl(pageUrl) {
    return pageUrl.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/edit";
}

function isExercismElementVisible(node) {
    return Boolean(node) && node.offsetWidth > 0 && node.offsetHeight > 0;
}

function isExercismOverviewSolved() {
    return [...document.querySelectorAll("h1, h2, h3, h4")].some(heading =>
        isExercismElementVisible(heading) &&
        EXERCISM_SOLVED_HEADING_PATTERN.test(
            (heading.innerText || heading.textContent || "").trim()
        )
    );
}

// The status badge is the only on-page copy that spells the state out, so scan
// the small status containers instead of the whole document: the exercise
// instructions and the track sidebar must never be able to match.
function isExercismOverviewMarkedInProgress() {
    for (const selector of EXERCISM_STATUS_BADGE_SELECTORS) {
        for (const node of document.querySelectorAll(selector)) {
            if (!isExercismElementVisible(node)) {
                continue;
            }

            const text = (node.innerText || node.textContent || "").trim();

            if (
                text.length <= EXERCISM_STATUS_BADGE_MAX_TEXT_LENGTH &&
                EXERCISM_IN_PROGRESS_TEXT_PATTERN.test(text)
            ) {
                return true;
            }
        }
    }

    return false;
}

function readExercismOverviewExerciseState() {
    const buttonState = readExercismOpenEditorButtonState();

    return {
        status: buttonState?.status || "",
        editorEnabled: buttonState?.editorEnabled !== false,
        solved: isExercismOverviewSolved(),
        inProgress:
            (buttonState !== null &&
                EXERCISM_IN_PROGRESS_STATUSES.includes(buttonState.status)) ||
            isExercismOverviewMarkedInProgress()
    };
}

function resolveExercismExerciseEditorRedirectTarget(pageUrl, exerciseState) {
    if (!EXERCISM_EXERCISE_OVERVIEW_URL.test(pageUrl)) {
        return "";
    }

    const state = exerciseState || {};

    if (state.solved === true) {
        return "";
    }

    // Never started: Exercism opens the editor itself for such an exercise, so
    // the redirect only mirrors the page.
    if (state.status === "available" && state.editorEnabled !== false) {
        return buildExercismEditorUrl(pageUrl);
    }

    // A submitted exercise is owned by the independent mark-complete script.
    // The redirect script only opens genuinely started exercises.
    if (
        state.inProgress === true &&
        (state.status === "started" || !state.status)
    ) {
        return buildExercismEditorUrl(pageUrl);
    }

    return "";
}

// One redirect per exercise and tab session. This stops a redirect loop if
// Exercism ever sends /edit back, and keeps browser Back working: Turbo's
// cached overview copy can still say "available" after the exercise started.
function editorRedirectAlreadyIssued(editorPath) {
    try {
        return sessionStorage.getItem(
            EXERCISM_EDITOR_REDIRECT_GUARD_PREFIX + editorPath
        ) === "1";
    } catch (_) {
        return false;
    }
}

function rememberEditorRedirect(editorPath) {
    try {
        sessionStorage.setItem(
            EXERCISM_EDITOR_REDIRECT_GUARD_PREFIX + editorPath,
            "1"
        );
    } catch (_) {
        // Storage can be unavailable; the redirect itself still works.
    }
}

let overviewCheckInFlight = false;
let editorRedirectIssued = false;
let overviewCheckPending = false;

async function openExercismEditorWhenOverviewHasNothingToConfirm() {
    if (overviewCheckInFlight || editorRedirectIssued) {
        overviewCheckPending = true;
        return;
    }

    if (!EXERCISM_EXERCISE_OVERVIEW_URL.test(location.href)) {
        return;
    }

    overviewCheckInFlight = true;

    try {
        if (!(await isExercismOpenNewExerciseInEditorEnabled())) {
            return;
        }

        const target = resolveExercismExerciseEditorRedirectTarget(
            location.href,
            readExercismOverviewExerciseState()
        );

        if (!target || editorRedirectAlreadyIssued(target)) {
            return;
        }

        rememberEditorRedirect(target);
        editorRedirectIssued = true;
        console.log(
            "[Exercism] overview page has nothing left to confirm; opening the editor:",
            target
        );
        location.assign(target);
    } finally {
        overviewCheckInFlight = false;

        if (overviewCheckPending && !editorRedirectIssued) {
            overviewCheckPending = false;
            openExercismEditorWhenOverviewHasNothingToConfirm();
        }
    }
}

function startExercismOverviewWatcher() {
    openExercismEditorWhenOverviewHasNothingToConfirm();

    // Exercism navigates with Turbo, so in-site navigation replaces the page
    // without reloading this content script; the observer covers late and
    // partially rendered markup as well.
    document.addEventListener(
        "turbo:load",
        openExercismEditorWhenOverviewHasNothingToConfirm
    );
    document.addEventListener(
        "turbo:render",
        openExercismEditorWhenOverviewHasNothingToConfirm
    );
    document.addEventListener(
        "DOMContentLoaded",
        openExercismEditorWhenOverviewHasNothingToConfirm
    );

    if (document.documentElement) {
        new MutationObserver(
            openExercismEditorWhenOverviewHasNothingToConfirm
        ).observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
}

if (document.documentElement) {
    startExercismOverviewWatcher();
} else {
    document.addEventListener("DOMContentLoaded", startExercismOverviewWatcher, {
        once: true
    });
}
