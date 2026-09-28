/* @machine
file: worker/adapters/exercism_edit_adapter.ts
role: own the exercism edit adapter site adapter
*/

function parseExercismFeedback(text: string) {
    const normalized = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();

    if (!normalized || !/(?:test\s+failures?|tests\s+passed|failed|expected|actual|error)/i.test(normalized)) {
        return "";
    }

    return normalized.slice(0, 30000);
}

const ExercismAdapter: CodingSiteAdapter = {

    name: "Exercism",

    match(url) {
        return EXERCISM_URL.test(url);
    },

    async testAndSubmit(tabId, { skipRun = false } = {}) {
        // Page functions passed to executePage must stay self-contained.
        // Use Exercism's own footer hooks:
        //   ".lhs-footer .run-tests-btn button" -> Run Tests
        //   ".lhs-footer .submit-btn button"    -> Submit
        // Matching buttons by text is not reliable: the tab bar also contains
        // "Tests" and a second "Submit" lives in the results panel, and
        // filtering out disabled buttons made /test/ match the "Tests" tab,
        // which silently swallowed the Ctrl+Enter action.
        const readState = () => executePage(tabId, () => {
            const runTests = document.querySelector(".lhs-footer .run-tests-btn button");
            const submit = document.querySelector(".lhs-footer .submit-btn button");
            const visible = (element: Element | null) =>
                !!element && element.offsetWidth > 0 && element.offsetHeight > 0;
            const statuses = [...document.querySelectorAll('[role="status"]')];

            return {
                editor: visible(runTests) && visible(submit),
                runTestsDisabled: !runTests || runTests.disabled,
                submitDisabled: !submit || submit.disabled,
                running: statuses.some(element =>
                    element.classList.contains("running") ||
                    /running tests/i.test(element.innerText || "")
                ),
                failed: /test failures?|tests failed|timed out/i.test(
                    statuses.map(element => element.innerText || "").join("\n")
                )
            };
        });

        const fail = async (reason: string) => {
            // Reveal the results panel so a failed run is visible, not silent.
            try {
                await executePage(tabId, () => {
                    const tab = [...document.querySelectorAll(".tabs .c-tab")]
                        .find(candidate => /results/i.test(candidate.innerText || ""));

                    if (tab) {
                        tab.click();
                    }
                });
            } catch (_) {
                // Best effort only; the original reason below matters more.
            }

            throw new Error(reason);
        };

        // replaceCode dispatches input/change immediately before this workflow
        // starts. Let React commit that new file state before interpreting two
        // disabled buttons as "no changes to test".
        const initialStateDeadline = performance.now() + 2000;
        let state = await readState();

        while (
            state?.editor &&
            state.runTestsDisabled &&
            state.submitDisabled &&
            !state.running &&
            performance.now() < initialStateDeadline
        ) {
            await sleep(50);
            state = await readState();
        }

        if (!state?.editor) {
            throw new Error("Exercism editor footer not found.");
        }

        // No new files to test and the last run did not pass: Submit cannot
        // become enabled without editing the solution first.
        if (state.runTestsDisabled && state.submitDisabled && !state.running) {
            await fail(
                "Exercism has no changes to test and the last run did not pass; " +
                "Submit stays disabled."
            );
        }

        // Run Tests is disabled while a run is in flight, and when the files
        // already match the last submission (nothing new to test). Only click
        // it when it is actually actionable.
        if (!skipRun && !state.runTestsDisabled) {
            await executePage(tabId, () => {
                const button = document.querySelector(".lhs-footer .run-tests-btn button");

                if (!button || button.disabled) {
                    return false;
                }

                button.click();
                return true;
            });
        }

        // Submit stays disabled until the newest run passed for exactly the
        // current files (Exercism: isSubmitDisabled = testRunStatus !== PASS ||
        // !filesEqual(...)). Wait for that state instead of a fixed delay,
        // which used to expire before a normal run (~7s) had finished.
        const waitStarted = performance.now();
        const waitDeadline = waitStarted + 60000;
        let sawRunning = false;

        while (performance.now() < waitDeadline) {
            const current = await readState();

            if (!current?.editor) {
                throw new Error(
                    "Exercism editor footer disappeared while waiting for tests."
                );
            }

            if (!current.submitDisabled) {
                break;
            }

            if (current.running) {
                sawRunning = true;
            } else if (sawRunning && current.failed) {
                await fail("Exercism tests failed, so Submit stays disabled.");
            } else if (!sawRunning && performance.now() - waitStarted > 15000) {
                await fail("Exercism test run did not start; Submit stays disabled.");
            }

            await sleep(250);
        }

        if ((await readState()).submitDisabled) {
            await fail("Exercism tests did not pass in time; Submit stays disabled.");
        }

        const submitted = await executePage(tabId, () => {
            const button = document.querySelector(".lhs-footer .submit-btn button");

            if (!button) {
                return { ok: false, reason: "Exercism submit button not found." };
            }

            if (button.disabled) {
                return {
                    ok: false,
                    reason: "Exercism submit button is disabled; tests must pass first."
                };
            }

            button.click();
            return { ok: true };
        });

        if (!submitted?.ok) {
            throw new Error(submitted?.reason || "Could not submit Exercism solution.");
        }

        return true;
    },

    async getContext(tabId) {
        const value = await executePage(tabId, async () => {
            const textWithoutMedia = (element: Element | null) => {
                if (!element) {
                    return "";
                }

                const copy = element.cloneNode(true) as HTMLElement;
                copy.querySelectorAll(
                    "img, picture, svg, video, audio, canvas, iframe"
                ).forEach((media: Element) => media.remove());
                return copy.innerText?.trim() || "";
            };
            const feedbackTabs = ["Instructions", "Tests", "Results"];
            const tabs = [...document.querySelectorAll(".tabs .c-tab")];
            const selectedFeedbackTab = tabs.find(tab =>
                feedbackTabs.some(label =>
                    label.toLowerCase() === (tab.innerText || "").trim().toLowerCase()
                ) && tab.classList.contains("selected")
            );
            const waitForTab = () => new Promise(resolve => setTimeout(resolve, 0));

            const readFeedbackPanels = async () => {
                const panels = [];

                for (const label of feedbackTabs) {
                    const tab = tabs.find(candidate =>
                        label.toLowerCase() ===
                        (candidate.innerText || "").trim().toLowerCase()
                    );

                    if (!tab) {
                        continue;
                    }

                    tab.click();
                    await waitForTab();

                    const panel = document.getElementById(
                        tab.getAttribute("aria-controls") || ""
                    );
                    const text = textWithoutMedia(panel)
                        .replace(/\r\n?/g, "\n")
                        .trim();

                    if (text) {
                        panels.push(`${label}\n${text}`);
                    }
                }

                if (selectedFeedbackTab) {
                    selectedFeedbackTab.click();
                }

                return panels.join("\n\n").slice(0, 30000);
            };

            const feedbackPromise = readFeedbackPanels();
            const editor = document.querySelector('[data-react-id="editor"]');

            if (editor) {
                const raw = editor.getAttribute("data-react-data");

                if (raw) {
                    try {
                        const data = JSON.parse(raw);
                        const files = data.default_files;

                        if (Array.isArray(files) && files.length > 0) {
                            return {
                                found: true,
                                method: "Exercism data",
                                files,
                                feedback: await feedbackPromise
                            };
                        }
                    } catch (_) {
                        // Try the rendered editor below.
                    }
                }
            }

            const candidates = [
                ...document.querySelectorAll(".cm-content"),
                ...document.querySelectorAll("textarea"),
                ...document.querySelectorAll('[contenteditable="true"]')
            ];

            for (const element of candidates) {
                const source = element.value || element.innerText || element.textContent;
                const visible = element.offsetWidth > 0 && element.offsetHeight > 0;

                if (visible && typeof source === "string" && source.trim()) {
                    return {
                        found: true,
                        method: "rendered editor",
                        files: [{ filename: "current-source", content: source }],
                        feedback: await feedbackPromise
                    };
                }
            }

            return {
                found: false,
                reason: "Exercism editor is not rendered yet"
            };
        });

        if (!value?.found) {
            throw new Error(
                "Could not extract Exercism editor data: " + value?.reason
            );
        }

        const source = value.files
            .map(file => `// ${file.filename}\n${file.content}`)
            .join("\n\n");

        console.log(
            "[Exercism] source extracted via",
            value.method,
            value.files.length,
            "files,",
            source.length,
            "characters"
        );

        return {
            platform: this.name,
            feedback: value.feedback,
            source
        };
    }
};
