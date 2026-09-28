/* @machine
file: worker/exercism/edit/return_to_editor_after_submit_redirect.js
role: keep a Submit-triggered Turbo redirect on the current exercise editor
scope: editor pages only
*/

const EXERCISM_FOOTER_SUBMIT_BUTTON_SELECTOR =
    ".lhs-footer .submit-btn button";
const EXERCISM_EDIT_PATH_PATTERN =
    /^\/tracks\/([^/]+)\/exercises\/([^/]+)\/edit\/?$/;

let submitRedirectReturnTarget = "";
let submitRedirectOverviewTarget = "";
let submitRedirectStartedAt = 0;

const SUBMIT_REDIRECT_MAX_AGE_MS = 120000;

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

function openSubmittedOverviewAndKeepEditor(target) {
    const sendMessage = globalThis.chrome?.runtime?.sendMessage;

    if (typeof sendMessage === "function") {
        try {
            sendMessage.call(globalThis.chrome.runtime, {
                type: "exercism-open-submitted-overview",
                overviewUrl: target.overviewUrl
            });
        } catch (_) {
            // The extension context may disappear while the page remains open.
        }
    }

    location.replace(target.editorUrl);
}

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
    openSubmittedOverviewAndKeepEditor(target);
}, true);

document.addEventListener("turbo:load", () => {
    if (getExercismEditorUrl(location.href) === submitRedirectReturnTarget) {
        return;
    }

    const target = consumeSubmitRedirectTarget(location.href);

    if (target) {
        openSubmittedOverviewAndKeepEditor(target);
        return;
    }

    submitRedirectReturnTarget = "";
    submitRedirectOverviewTarget = "";
    submitRedirectStartedAt = 0;
}, true);