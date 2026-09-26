/* @machine
file: worker/exercism/edit/continue_after_exercism_modals.js
role: dismiss the editor's first-run and delayed-feedback dialogs
scope: editor pages only
*/

const handledContinueButtons = new WeakSet();

function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function continueExercismDialogs() {
    const dialogs = document.querySelectorAll("dialog, [role='dialog']");

    for (const dialog of dialogs) {
        if (!isVisible(dialog)) {
            continue;
        }

        const buttons = dialog.querySelectorAll("button, [role='button']");

        for (const button of buttons) {
            const label = button.innerText?.replace(/\s+/g, " ").trim();

            if (
                (label === "Continue" || label === "Continue without waiting") &&   //hardcode！
                !button.disabled &&
                button.getAttribute("aria-disabled") !== "true" &&
                isVisible(button) &&
                !handledContinueButtons.has(button)
            ) {
                handledContinueButtons.add(button);
                button.click();
            }
        }
    }
}

function startExercismDialogWatcher() {
    continueExercismDialogs();
    document.addEventListener("turbo:load", continueExercismDialogs);
    document.addEventListener("turbo:render", continueExercismDialogs);
    new MutationObserver(continueExercismDialogs).observe(document.documentElement, {
        childList: true,
           subtree: true,
           attributes: true,
           attributeFilter: ["disabled", "aria-disabled"]
    });
}

if (document.documentElement) {
    startExercismDialogWatcher();
} else {
    document.addEventListener("DOMContentLoaded", startExercismDialogWatcher, {
        once: true
    });
}