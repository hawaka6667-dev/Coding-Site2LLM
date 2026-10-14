/* @machine
file: worker/adam_math_hhu/level_navigation.js
role: map left and right arrows to Adam Math HHU level navigation outside editors
*/

function isAdamMathHHULevelPage() {
    return location.hostname === "adam.math.hhu.de" &&
        /^#\/g\/[^/]+\/[^/]+\/world\//.test(location.hash);
}

function isAdamMathHHUEditTarget(target) {
    return Boolean(
        target?.isContentEditable ||
        target?.closest?.("input, textarea, select, [contenteditable='true'], .monaco-editor")
    );
}

function clickAdamMathHHULevelNavigation(event) {
    if (
        !isAdamMathHHULevelPage() ||
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
        isAdamMathHHUEditTarget(event.target) ||
        isAdamMathHHUEditTarget(document.activeElement)
    ) {
        return;
    }

    const title = event.key === "ArrowLeft" ? "previous level" : "next level";
    const control = [...document.querySelectorAll("a[title], button[title]")]
        .find(candidate =>
            candidate.title.toLowerCase() === title &&
            candidate.offsetWidth > 0 &&
            candidate.offsetHeight > 0 &&
            !candidate.disabled &&
            candidate.getAttribute("aria-disabled") !== "true"
        );

    if (!control) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    control.click();
}

document.addEventListener("keydown", clickAdamMathHHULevelNavigation, true);