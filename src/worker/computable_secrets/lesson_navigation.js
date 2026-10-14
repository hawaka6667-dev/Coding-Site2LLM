/* @machine
file: worker/computable_secrets/lesson_navigation.js
role: map left and right arrows to Computable Secrets lesson navigation outside editors
*/

const COMPUTABLE_SECRETS_EDITABLE_SELECTOR =
    "input, textarea, select, [contenteditable='true'], [role='textbox'], .lean-code-input";
const COMPUTABLE_SECRETS_CHECK_BUTTON_TEXT = "check exercise";
const COMPUTABLE_SECRETS_WORKED_SOLUTION_TEXT = "read a worked solution";

let activeComputableSecretsLesson = "";
let checkedComputableSecretsLesson = "";
let openedComputableSecretsSolutionLesson = "";

function isComputableSecretsLessonPage() {
    const pageUrl = new URL(location.href);
    return pageUrl.hostname === "computablesecrets.com" &&
        pageUrl.pathname.startsWith("/learn/leanlings/") &&
        pageUrl.searchParams.has("lesson");
}

function clickComputableSecretsCheckExercise() {
    const pageUrl = new URL(location.href);
    if (
        pageUrl.hostname !== "computablesecrets.com" ||
        !pageUrl.pathname.startsWith("/learn/leanlings/") ||
        !pageUrl.searchParams.has("lesson")
    ) {
        activeComputableSecretsLesson = "";
        checkedComputableSecretsLesson = "";
        openedComputableSecretsSolutionLesson = "";
        return;
    }

    const lesson = `${pageUrl.pathname}?lesson=${pageUrl.searchParams.get("lesson")}`;
    if (lesson !== activeComputableSecretsLesson) {
        activeComputableSecretsLesson = lesson;
        checkedComputableSecretsLesson = "";
        openedComputableSecretsSolutionLesson = "";
    }

    if (checkedComputableSecretsLesson !== lesson) {
        const button = [...document.querySelectorAll("button")].find(candidate =>
            (candidate.innerText || candidate.textContent || "")
                .trim()
                .replace(/\s+/g, " ")
                .toLowerCase() === COMPUTABLE_SECRETS_CHECK_BUTTON_TEXT &&
            candidate.offsetWidth > 0 &&
            candidate.offsetHeight > 0 &&
            !candidate.disabled &&
            candidate.getAttribute("aria-disabled") !== "true"
        );

        if (button) {
            checkedComputableSecretsLesson = lesson;
            button.click();
        }
    }

    if (openedComputableSecretsSolutionLesson !== lesson) {
        const solutionSummary = [...document.querySelectorAll("summary")].find(candidate =>
            (candidate.innerText || candidate.textContent || "")
                .trim()
                .replace(/\s+/g, " ")
                .toLowerCase() === COMPUTABLE_SECRETS_WORKED_SOLUTION_TEXT &&
            candidate.parentElement?.tagName === "DETAILS" &&
            candidate.offsetWidth > 0 &&
            candidate.offsetHeight > 0
        );

        if (solutionSummary) {
            openedComputableSecretsSolutionLesson = lesson;
            if (!solutionSummary.parentElement.open) {
                solutionSummary.click();
            }
        }
    }
}

function startComputableSecretsLessonAutomation() {
    if (!document.documentElement) {
        document.addEventListener(
            "DOMContentLoaded",
            startComputableSecretsLessonAutomation,
            { once: true }
        );
        return;
    }

    clickComputableSecretsCheckExercise();
    new MutationObserver(clickComputableSecretsCheckExercise).observe(
        document.documentElement,
        { childList: true, subtree: true }
    );
}

function isComputableSecretsEditTarget(target) {
    return Boolean(
        target?.isContentEditable ||
        target?.closest?.(COMPUTABLE_SECRETS_EDITABLE_SELECTOR)
    );
}

function clickComputableSecretsLessonNavigation(event) {
    if (
        !isComputableSecretsLessonPage() ||
        !["ArrowLeft", "ArrowRight"].includes(event.key) ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
    ) {
        return;
    }

    if (
        isComputableSecretsEditTarget(event.target) ||
        isComputableSecretsEditTarget(document.activeElement)
    ) {
        return;
    }

    const controlId = event.key === "ArrowLeft"
        ? "previous-lesson"
        : "next-lesson";
    const control = document.querySelector(
        `.lesson-navigation #${controlId}`
    );

    if (
        !control ||
        control.offsetWidth <= 0 ||
        control.offsetHeight <= 0 ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true"
    ) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    control.click();
}

document.addEventListener("keydown", clickComputableSecretsLessonNavigation, true);
startComputableSecretsLessonAutomation();