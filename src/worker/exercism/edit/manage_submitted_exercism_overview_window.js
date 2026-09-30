/* @machine
file: worker/exercism/edit/manage_submitted_exercism_overview_window.js
role: own the submitted overview window lifecycle
scope: editor submission redirect and submitted overview completion
*/

const EXERCISM_FOOTER_SUBMIT_BUTTON_SELECTOR =
    ".lhs-footer .submit-btn button";
const EXERCISM_EDIT_PATH_PATTERN =
    /^\/tracks\/([^/]+)\/exercises\/([^/]+)\/edit\/?$/;
const EXERCISM_OVERVIEW_URL_PATTERN =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;
const SUBMIT_REDIRECT_MAX_AGE_MS = 120000;
const AUTO_MARK_COMPLETE_SETTING_KEY = "exercismAutoMarkComplete";

let submitRedirectReturnTarget = "";
let submitRedirectOverviewTarget = "";
let submitRedirectStartedAt = 0;

function getExercismEditorUrl(value) {
    try {
        const url = new URL(value, location.href);

        return EXERCISM_EDIT_PATH_PATTERN.test(url.pathname)
            ? `${url.origin}${url.pathname.replace(/\/$/, "")}`
            : "";
    } catch (_) {
        return "";
    }
}

function isOverviewForEditor(overviewUrl, editorUrl) {
    try {
        const overview = new URL(overviewUrl, location.href);
        const editor = new URL(editorUrl);
        const editorMatch = editor.pathname.match(EXERCISM_EDIT_PATH_PATTERN);

        return Boolean(
            editorMatch &&
            overview.origin === editor.origin &&
            overview.pathname ===
                `/tracks/${editorMatch[1]}/exercises/${editorMatch[2]}`
        );
    } catch (_) {
        return false;
    }
}

function isExercismOverviewPage(url = location.href) {
    return EXERCISM_OVERVIEW_URL_PATTERN.test(url);
}

function getBackToExerciseUrl() {
    const link = [...document.querySelectorAll("a[href], [role='link'][href]")]
        .find(candidate =>
            candidate.offsetWidth > 0 &&
            candidate.offsetHeight > 0 &&
            /back to exercise/i.test(
                `${candidate.innerText || ""} ${candidate.getAttribute("aria-label") || ""}`
            )
        );

    return link?.href || "";
}

function consumeSubmitRedirectTarget(overviewUrl) {
    const editorUrl = submitRedirectReturnTarget;
    const backToExerciseUrl = submitRedirectOverviewTarget;

    if (!editorUrl) {
        return null;
    }

    if (Date.now() - submitRedirectStartedAt > SUBMIT_REDIRECT_MAX_AGE_MS) {
        submitRedirectReturnTarget = "";
        submitRedirectOverviewTarget = "";
        submitRedirectStartedAt = 0;
        return null;
    }

    if (
        !isOverviewForEditor(overviewUrl, editorUrl) ||
        !isOverviewForEditor(backToExerciseUrl, editorUrl)
    ) {
        return null;
    }

    submitRedirectReturnTarget = "";
    submitRedirectOverviewTarget = "";
    submitRedirectStartedAt = 0;
    return { editorUrl, overviewUrl: backToExerciseUrl };
}

async function openSubmittedOverviewAndKeepEditor(target, navigateToOverviewOnFailure) {
    let opened = false;

    try {
        const stored = await chrome.storage.local.get(AUTO_MARK_COMPLETE_SETTING_KEY);
        if (stored[AUTO_MARK_COMPLETE_SETTING_KEY] !== false) {
            const response = await chrome.runtime.sendMessage({
                type: "exercism-create-submitted-overview-window",
                overviewUrl: target.overviewUrl
            });
            opened = response?.opened === true;
        }
    } catch (_) {
        opened = false;
    }

    if (opened) {
        location.replace(target.editorUrl);
    } else if (navigateToOverviewOnFailure) {
        location.replace(target.overviewUrl);
    }
}

function closeSubmittedOverviewAfterCompletion(message) {
    if (
        message?.type !== "exercism-submitted-overview-completion-result" ||
        message.completed !== true ||
        !isExercismOverviewPage()
    ) {
        return;
    }

    chrome.runtime.sendMessage({
        type: "exercism-close-submitted-overview-window"
    }).catch(() => {});
}

chrome.runtime.onMessage.addListener(closeSubmittedOverviewAfterCompletion);

document.addEventListener("click", event => {
    const button = event.target?.closest?.(
        EXERCISM_FOOTER_SUBMIT_BUTTON_SELECTOR
    );

    if (!button || button.disabled) {
        return;
    }

    submitRedirectReturnTarget = getExercismEditorUrl(location.href);
    submitRedirectOverviewTarget = getBackToExerciseUrl();
    submitRedirectStartedAt = Date.now();
}, true);

document.addEventListener("turbo:before-visit", event => {
    const target = consumeSubmitRedirectTarget(event.detail?.url);

    if (!target) {
        return;
    }

    event.preventDefault();
    void openSubmittedOverviewAndKeepEditor(target, true);
}, true);

document.addEventListener("turbo:load", () => {
    if (getExercismEditorUrl(location.href) === submitRedirectReturnTarget) {
        return;
    }

    const target = consumeSubmitRedirectTarget(location.href);

    if (target) {
        void openSubmittedOverviewAndKeepEditor(target, false);
        return;
    }

    submitRedirectReturnTarget = "";
    submitRedirectOverviewTarget = "";
    submitRedirectStartedAt = 0;
}, true);