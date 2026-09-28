/* @machine
file: worker/exercism/overview/dismiss_exercism_overview_closable_dialogs.js
role: dismiss visible Exercism overview dialogs with a Close control
scope: overview pages only
*/

const handledExercismOverviewCloseButtons = new WeakSet();

function isExercismOverviewElementVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isExercismOverviewCloseButton(button) {
    const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.innerText
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

    return /\bclose\b|关闭/i.test(label) || label === "×";
}

function dismissExercismOverviewClosableDialogs() {
    const dialogs = document.querySelectorAll("dialog, [role='dialog']");

    for (const dialog of dialogs) {
        if (!isExercismOverviewElementVisible(dialog)) {
            continue;
        }

        const closeButton = [...dialog.querySelectorAll("button, [role='button']")].find(button =>
            !button.disabled &&
            button.getAttribute("aria-disabled") !== "true" &&
            isExercismOverviewElementVisible(button) &&
            isExercismOverviewCloseButton(button) &&
            !handledExercismOverviewCloseButtons.has(button)
        );

        if (closeButton) {
            handledExercismOverviewCloseButtons.add(closeButton);
            closeButton.click();
        }
    }
}

function startExercismOverviewClosableDialogWatcher() {
    dismissExercismOverviewClosableDialogs();
    document.addEventListener("turbo:load", dismissExercismOverviewClosableDialogs);
    document.addEventListener("turbo:render", dismissExercismOverviewClosableDialogs);
    new MutationObserver(dismissExercismOverviewClosableDialogs).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}

if (document.documentElement) {
    startExercismOverviewClosableDialogWatcher();
} else {
    document.addEventListener("DOMContentLoaded", startExercismOverviewClosableDialogWatcher, {
        once: true
    });
}