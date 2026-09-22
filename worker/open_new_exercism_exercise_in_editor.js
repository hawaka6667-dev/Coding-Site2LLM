/*
 * Responsibility: Exercism exercise overview page content script.
 * A brand-new exercise opens its editor by default, so the user lands on
 * /edit instead of the overview page.
 *
 * Verified against the real pages (2026-09):
 *   - An overview CTA still reads "Start in editor" and still sits in
 *     ".action-box.pending" for a started exercise, so neither the button text
 *     nor the action-box class can tell a new exercise from a started one.
 *   - "[data-react-id=student-open-editor-button]" data-react-data carries the
 *     real status: "available" before starting, and "started" / "iterated" /
 *     "completed" once the exercise has been opened or submitted.
 *   - Opening /edit for an "available" exercise does not bounce back and flips
 *     the status to "started", so the redirect is one-way.
 *
 * The whole behaviour is gated by the exercismOpenNewExerciseInEditor setting,
 * which is declared here and toggled from the extension popup (popup.js)
 * because the release build may not want it.
 */

const EXERCISM_EXERCISE_OVERVIEW_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

const EXERCISM_OPEN_EDITOR_BUTTON_SELECTOR =
    '[data-react-id="student-open-editor-button"]';

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

function resolveExercismExerciseEditorRedirectTarget(pageUrl, editorButton) {
    if (!EXERCISM_EXERCISE_OVERVIEW_URL.test(pageUrl)) {
        return "";
    }

    // Only an exercise that has never been started is redirected. Real statuses
    // observed on Exercism are "available", "started", "iterated" (submitted,
    // not completed) and "completed"; anything but "available" keeps the
    // overview page.
    if (
        editorButton?.status !== "available" ||
        editorButton.editorEnabled === false
    ) {
        return "";
    }

    return pageUrl.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/edit";
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

async function openNewExercismExerciseInEditor() {
    if (overviewCheckInFlight || editorRedirectIssued) {
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
            readExercismOpenEditorButtonState()
        );

        if (!target || editorRedirectAlreadyIssued(target)) {
            return;
        }

        rememberEditorRedirect(target);
        editorRedirectIssued = true;
        console.log(
            "[Exercism] exercise is still available; opening the editor:",
            target
        );
        location.assign(target);
    } finally {
        overviewCheckInFlight = false;
    }
}

function startExercismOverviewWatcher() {
    openNewExercismExerciseInEditor();

    // Exercism navigates with Turbo, so in-site navigation replaces the page
    // without reloading this content script; the observer covers late and
    // partially rendered markup as well.
    document.addEventListener("turbo:load", openNewExercismExerciseInEditor);
    document.addEventListener("turbo:render", openNewExercismExerciseInEditor);
    document.addEventListener("DOMContentLoaded", openNewExercismExerciseInEditor);

    if (document.documentElement) {
        new MutationObserver(openNewExercismExerciseInEditor).observe(
            document.documentElement,
            { childList: true, subtree: true }
        );
    }
}

if (document.documentElement) {
    startExercismOverviewWatcher();
} else {
    document.addEventListener("DOMContentLoaded", startExercismOverviewWatcher, {
        once: true
    });
}
