/* @machine
file: worker/learncodefast/course_page_automation.js
role: automate LearnCodeFast course completion and lesson navigation
scope: LearnCodeFast course pages only
owns: completion control, quiz progression, and lesson navigation
events: initial load | keydown | MutationObserver
*/

const LEARNCODEFAST_COURSE_URL_PATTERN =
    /^https:\/\/(?:www\.)?learncodefast\.org\/courses\/[^/?#]+(?:[/?#]|$)/i;

let pageUrl = location.href;
let clickedButtons = new WeakSet();
const COURSE_PAGE_SCAN_DELAYS_MS = [0, 100, 300, 1000];     //渲染延迟

function isLearnCodeFastCoursePage(url = location.href) {
    return LEARNCODEFAST_COURSE_URL_PATTERN.test(url);
}

function isVisible(element) {
    return element.offsetWidth > 0 && element.offsetHeight > 0;
}

function clickMarkAsComplete() {
    const currentUrl = location.href;
    if (currentUrl !== pageUrl) {
        pageUrl = currentUrl;
        clickedButtons = new WeakSet();
    }

    if (!isLearnCodeFastCoursePage(currentUrl)) {
        return;
    }

    const button = [...document.querySelectorAll("button")].find(candidate =>
        isVisible(candidate) &&
        !candidate.disabled &&
        candidate.getAttribute?.("aria-disabled") !== "true" &&
        /mark as complete/i.test(candidate.innerText.trim()) &&
        !clickedButtons.has(candidate)
    );

    if (!button) {
        return;
    }

    clickedButtons.add(button);
    button.click();
}

function scanAfterNavigation() {    //spa导航？？
    for (const delay of COURSE_PAGE_SCAN_DELAYS_MS) {
        globalThis.setTimeout?.(clickMarkAsComplete, delay);
    }
}

function installNavigationListeners() {
    globalThis.addEventListener?.("popstate", scanAfterNavigation);
    globalThis.addEventListener?.("hashchange", scanAfterNavigation);
    globalThis.addEventListener?.("pageshow", scanAfterNavigation);

    if (!globalThis.history) {
        return;
    }

    for (const methodName of ["pushState", "replaceState"]) {
        const originalMethod = globalThis.history[methodName];
        if (typeof originalMethod !== "function") {
            continue;
        }

        globalThis.history[methodName] = function (...args) {
            const result = originalMethod.apply(this, args);
            scanAfterNavigation();
            return result;
        };
    }
}

function clickNextQuestionOnEnter(event) {       //无关紧要且可能坏掉的功能
    if (
        event.key !== "Enter" ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
    ) {
        return;
    }

    const target = event.target;
    if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
    ) {
        return;
    }

    const button = [...document.querySelectorAll("button")].find(candidate =>
        isVisible(candidate) &&
        !candidate.disabled &&
        candidate.getAttribute?.("aria-disabled") !== "true" &&
        /next question/i.test(candidate.innerText.trim())
    );

    if (!button) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    button.click();
}

function clickLessonNavigationOnArrow(event) {
    if (
        !["ArrowLeft", "ArrowRight"].includes(event.key) ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
    ) {
        return;
    }

    const target = event.target;
    if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
    ) {
        return;
    }

    const lessonPattern = event.key === "ArrowLeft"
        ? /previous lesson/i
        : /next lesson/i;
    const link = [...document.querySelectorAll("a, button")].find(candidate =>
        isVisible(candidate) &&
        !candidate.disabled &&
        candidate.getAttribute?.("aria-disabled") !== "true" &&
        lessonPattern.test(candidate.innerText.trim())
    );

    if (!link) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    link.click();
}

clickMarkAsComplete();
if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("keydown", clickNextQuestionOnEnter, true);
    globalThis.addEventListener("keydown", clickLessonNavigationOnArrow, true);
}

installNavigationListeners();

new MutationObserver(clickMarkAsComplete).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "style", "class"]
});