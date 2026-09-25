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

function consumeSubmitRedirectTarget(overviewUrl) {
    const editorUrl = submitRedirectReturnTarget;

    if (!editorUrl) {
        return "";
    }

    if (Date.now() - submitRedirectStartedAt > SUBMIT_REDIRECT_MAX_AGE_MS) {
        submitRedirectReturnTarget = "";
        submitRedirectStartedAt = 0;
        return "";
    }

    if (!isOverviewForEditor(overviewUrl, editorUrl)) {
        return "";
    }

    submitRedirectReturnTarget = "";
    submitRedirectStartedAt = 0;
    return editorUrl;
}

document.addEventListener("click", event => {
    const button = event.target?.closest?.(
        EXERCISM_FOOTER_SUBMIT_BUTTON_SELECTOR
    );

    if (!button || button.disabled) {
        return;
    }

    submitRedirectReturnTarget = getExercismEditorUrl(location.href);
    submitRedirectStartedAt = Date.now();
}, true);

document.addEventListener("turbo:before-visit", event => {
    const editorUrl = consumeSubmitRedirectTarget(event.detail?.url);

    if (!editorUrl) {
        return;
    }

    event.preventDefault();
    location.replace(editorUrl);
}, true);

document.addEventListener("turbo:load", () => {
    if (getExercismEditorUrl(location.href) === submitRedirectReturnTarget) {
        return;
    }

    const editorUrl = consumeSubmitRedirectTarget(location.href);

    if (editorUrl) {
        location.replace(editorUrl);
        return;
    }

    submitRedirectReturnTarget = "";
    submitRedirectStartedAt = 0;
}, true);