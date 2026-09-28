/* @machine
file: worker/exercism/edit/auto_submit_after_manual_run.js
role: continue Exercism's manual Run Tests action into Submit
scope: editor pages only
*/

const RUN_TESTS_BUTTON_SELECTOR = ".lhs-footer .run-tests-btn button";
const AUTO_SUBMIT_AFTER_MANUAL_RUN_SETTING_KEY =
    "exercismAutoSubmitAfterManualRun";
let submitRequestPending = false;

async function requestSubmitAfterRunTests() {
    if (submitRequestPending) {
        return;
    }

    submitRequestPending = true;
    setTimeout(() => {
        chrome.storage.local.get(AUTO_SUBMIT_AFTER_MANUAL_RUN_SETTING_KEY)
            .then(stored => {
                if (stored[AUTO_SUBMIT_AFTER_MANUAL_RUN_SETTING_KEY] === false) {
                    submitRequestPending = false;
                    return;
                }

                const runtime = globalThis.chrome?.runtime;
                if (typeof runtime?.sendMessage !== "function") {
                    submitRequestPending = false;
                    return;
                }

                try {
                    runtime.sendMessage({ type: "exercism-run-tests-clicked" }, () => {
                        void runtime.lastError;
                        submitRequestPending = false;
                    });
                } catch (_) {
                    submitRequestPending = false;
                }
            })
            .catch(() => {
                submitRequestPending = false;
            });
    }, 0);
}

document.addEventListener("click", event => {
    const button = event.target?.closest?.(RUN_TESTS_BUTTON_SELECTOR);

    if (button && !button.disabled) {
        requestSubmitAfterRunTests();
    }
}, true);
