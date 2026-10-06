/* @machine
file: worker/exercism/dismiss_dialogs.js
role: dismiss safe continuation actions in Exercism modal dialogs
scope: all Exercism track pages
*/

(() => {
    const handledButtons = new WeakSet();
    const dismissLabelPattern =
        /^(?:close(?: this)?(?: (?:dialog|modal|popup))?|dismiss(?: this)?(?: (?:dialog|modal|popup))?|skip(?: for now)?|not now|not right now|maybe later|no thanks|later|got it|ok(?:ay)?|i(?:'|’)ll do it later|i will do it later)$/i;
    const continueLabelPattern = /^continue(?: without .+| anyway| for now)?$/i;

    function isVisible(node) {
        if (typeof node.checkVisibility === "function" && !node.checkVisibility()) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function normalizeLabel(label) {
        return label
            .replace(/[,.!?;:]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function getDismissPriority(button) {
        const label = normalizeLabel(
            button.getAttribute("aria-label") ||
                button.innerText ||
                button.getAttribute("title") ||
                ""
        );

        if (dismissLabelPattern.test(label)) {
            return 0;
        }
        if (continueLabelPattern.test(label)) {
            return 1;
        }
        return Infinity;
    }

    function dismissExercismDialogs() {
        const dialogs = document.querySelectorAll(
            "dialog, [role='dialog'], [aria-modal='true']"
        );

        for (const dialog of dialogs) {
            if (!isVisible(dialog)) {
                continue;
            }

            let selectedButton = null;
            let selectedPriority = Infinity;

            for (const button of dialog.querySelectorAll("button, [role='button']")) {
                if (
                    button.disabled ||
                    button.getAttribute("aria-disabled")?.toLowerCase() === "true" ||
                    !isVisible(button) ||
                    handledButtons.has(button)
                ) {
                    continue;
                }

                const priority = getDismissPriority(button);
                if (priority < selectedPriority) {
                    selectedButton = button;
                    selectedPriority = priority;
                }
            }

            if (selectedButton) {
                handledButtons.add(selectedButton);
                selectedButton.click();
            }
        }
    }

    function startExercismDialogWatcher() {
        dismissExercismDialogs();
        document.addEventListener("turbo:load", dismissExercismDialogs);
        document.addEventListener("turbo:render", dismissExercismDialogs);
        new MutationObserver(dismissExercismDialogs).observe(document.documentElement, {
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
})();
