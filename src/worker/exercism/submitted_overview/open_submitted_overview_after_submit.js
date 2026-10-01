/* @machine
file: worker/exercism/submitted_overview/open_submitted_overview_after_submit.js
role: open the submitted exercise overview while keeping the editor available
scope: Exercism edit pages only
*/

const SUBMITTED_OVERVIEW_SUBMIT_BUTTON_SELECTOR =
    ".lhs-footer .submit-btn button";
const SUBMITTED_OVERVIEW_EDITOR_PATH_PATTERN =
    /^\/tracks\/([^/]+)\/exercises\/([^/]+)\/edit\/?$/;
const SUBMITTED_OVERVIEW_REDIRECT_MAX_AGE_MS = 120000;
const SUBMITTED_OVERVIEW_AUTO_MARK_COMPLETE_SETTING_KEY = "exercismAutoMarkComplete";

let submittedOverviewEditorReturnTarget = "";
let submittedOverviewBackLinkTarget = "";
let submittedOverviewSubmitStartedAt = 0;

function getSubmittedOverviewEditorUrl(value) {
    try {
        const url = new URL(value, location.href);

        return SUBMITTED_OVERVIEW_EDITOR_PATH_PATTERN.test(url.pathname)
            ? `${url.origin}${url.pathname.replace(/\/$/, "")}`
            : "";
    } catch (_) {
        return "";
    }
}

function isSubmittedOverviewForEditor(overviewUrl, editorUrl) {
    try {
        const overview = new URL(overviewUrl, location.href);
        const editor = new URL(editorUrl);
        const editorMatch = editor.pathname.match(
            SUBMITTED_OVERVIEW_EDITOR_PATH_PATTERN
        );

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

function getSubmittedOverviewBackLinkUrl() {
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

function consumeSubmittedOverviewRedirectTarget(overviewUrl) {
    const editorUrl = submittedOverviewEditorReturnTarget;
    const backLinkUrl = submittedOverviewBackLinkTarget;

    if (!editorUrl) {
        return null;
    }

    if (Date.now() - submittedOverviewSubmitStartedAt > SUBMITTED_OVERVIEW_REDIRECT_MAX_AGE_MS) {
        submittedOverviewEditorReturnTarget = "";
        submittedOverviewBackLinkTarget = "";
        submittedOverviewSubmitStartedAt = 0;
        return null;
    }

    if (
        !isSubmittedOverviewForEditor(overviewUrl, editorUrl) ||
        !isSubmittedOverviewForEditor(backLinkUrl, editorUrl)
    ) {
        return null;
    }

    submittedOverviewEditorReturnTarget = "";
    submittedOverviewBackLinkTarget = "";
    submittedOverviewSubmitStartedAt = 0;
    return { editorUrl, overviewUrl: backLinkUrl };
}

async function openSubmittedOverviewAndKeepEditor(target, navigateToOverviewOnFailure) {
    let opened = false;

    try {
        const stored = await chrome.storage.local.get(
            SUBMITTED_OVERVIEW_AUTO_MARK_COMPLETE_SETTING_KEY
        );
        if (stored[SUBMITTED_OVERVIEW_AUTO_MARK_COMPLETE_SETTING_KEY] !== false) {
            const response = await chrome.runtime.sendMessage({
                type: "exercism-create-submitted-overview-window",
                overviewUrl: target.overviewUrl,
                editorUrl: target.editorUrl
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

document.addEventListener("click", event => {
    const button = event.target?.closest?.(
        SUBMITTED_OVERVIEW_SUBMIT_BUTTON_SELECTOR
    );

    if (!button || button.disabled) {
        return;
    }

    submittedOverviewEditorReturnTarget = getSubmittedOverviewEditorUrl(location.href);
    submittedOverviewBackLinkTarget = getSubmittedOverviewBackLinkUrl();
    submittedOverviewSubmitStartedAt = Date.now();
}, true);

document.addEventListener("turbo:before-visit", event => {
    const target = consumeSubmittedOverviewRedirectTarget(event.detail?.url);

    if (!target) {
        return;
    }

    event.preventDefault();
    void openSubmittedOverviewAndKeepEditor(target, true);
}, true);

document.addEventListener("turbo:load", () => {
    if (getSubmittedOverviewEditorUrl(location.href) === submittedOverviewEditorReturnTarget) {
        return;
    }

    const target = consumeSubmittedOverviewRedirectTarget(location.href);

    if (target) {
        void openSubmittedOverviewAndKeepEditor(target, false);
        return;
    }

    submittedOverviewEditorReturnTarget = "";
    submittedOverviewBackLinkTarget = "";
    submittedOverviewSubmitStartedAt = 0;
}, true);