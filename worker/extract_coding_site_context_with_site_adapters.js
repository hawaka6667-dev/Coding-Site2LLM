/* @machine
file: worker/extract_coding_site_context_with_site_adapters.js
role: extract page context and automate site editor actions
scope: Exercism; LeetCode
contract: executePage functions are self-contained
*/

function parseExercismFeedback(text) {
    const normalized = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();

    if (!normalized || !/(?:test\s+failures?|tests\s+passed|failed|expected|actual|error)/i.test(normalized)) {
        return "";
    }

    return normalized.slice(0, 30000);
}

const ExercismAdapter = {

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
            const visible = element =>
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

        const fail = async reason => {
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

        const state = await readState();

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

        // Submitting opens Exercism's "checking for automated feedback" modal,
        // which holds the redirect until "Continue without waiting" is clicked.
        // Once the editor footer is gone the redirect already happened.
        const modalDeadline = performance.now() + 10000;

        try {
            while (performance.now() < modalDeadline) {
                const modal = await executePage(tabId, () => {
                    const button = [...document.querySelectorAll("button")]
                        .find(candidate =>
                            candidate.offsetWidth > 0 &&
                            candidate.offsetHeight > 0 &&
                            /continue without waiting/i.test(candidate.innerText || "")
                        );

                    if (!button) {
                        return {
                            dismissed: false,
                            leftEditor: !document.querySelector(
                                ".lhs-footer .submit-btn button"
                            )
                        };
                    }

                    button.click();
                    return { dismissed: true, leftEditor: false };
                });

                if (!modal || modal.dismissed || modal.leftEditor) {
                    break;
                }

                await sleep(250);
            }
        } catch (_) {
            // The page may already have navigated; nothing left to dismiss.
        }

    },

    async getContext(tabId) {
        const value = await executePage(tabId, async () => {
            const textWithoutMedia = element => {
                if (!element) {
                    return "";
                }

                const copy = element.cloneNode(true);
                copy.querySelectorAll(
                    "img, picture, svg, video, audio, canvas, iframe"
                ).forEach(media => media.remove());
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

const LeetCodeAdapter = {

    name: "LeetCode",

    match(url) {
        return LEETCODE_URL.test(url);
    },

    async getContext(tabId) {
        const value = await executePage(tabId, () => {
            const textWithoutMedia = element => {
                if (!element) {
                    return "";
                }
                const copy = element.cloneNode(true);
                copy.querySelectorAll(
                    "img, picture, svg, video, audio, canvas, iframe"
                ).forEach(media => media.remove());
                return copy.innerText?.trim() || "";
            };

            const title =
                textWithoutMedia(document.querySelector("h1")) ||
                document.querySelector('meta[property="og:title"]')?.content?.trim() ||
                document.title.trim();

            // Only transport visible problem text. SEO/meta text is generated
            // page content and may include Editorial instructions.
            const visibleDescription =
                textWithoutMedia(document.querySelector('[data-track-load="description_content"]')) ||
                textWithoutMedia(document.querySelector('div[class*="description__"]')) ||
                "";
            const description = visibleDescription
                .replace(/Can\s+you\s+solve\s+this\s+real\s+interview\s+question\?\s*/i, "")
                .replace(/(?:^|\n)\s*Beats\s+\d+(?:\.\d+)?%[^\n]*(?:\n|$)/gi, "\n")
                .replace(/\s+/g, " ")
                .split(/Questions\s+you\s+should\s+ask\s+yourself|Editorial/i)[0]
                .trim();

            const feedbackKeywords = [
                "Accepted",
                "Wrong Answer",
                "Runtime Error",
                "Time Limit Exceeded",
                "Compile Error",
                "Memory Limit Exceeded",
                "输入",
                "输出",
                "Expected"
            ];
            const cleanFeedback = text => text
                .split(/\r?\n/)
                .map(line => line.replace(/\s+Beats\b.*$/i, "").trim())
                .filter(line => line && !/^Beats\b/i.test(line))
                .join("\n");
            const feedbackCandidates = [
                ...document.querySelectorAll(
                    '[data-e2e-locator], [class*="result"], [class*="console"]'
                )
            ];
            const feedback = feedbackCandidates
                .map(element => ({
                    text: cleanFeedback(textWithoutMedia(element)),
                    visible: element.offsetWidth > 0 && element.offsetHeight > 0
                }))
                .filter(candidate =>
                    candidate.visible &&
                    candidate.text.length > 0 &&
                    candidate.text.length <= 12000 &&
                    feedbackKeywords.some(keyword => candidate.text.includes(keyword))
                )
                .sort((left, right) => right.text.length - left.text.length)[0]?.text || "";

            if (window.monaco && window.monaco.editor) {
                const models = window.monaco.editor.getModels();

                for (const model of models) {
                    const source = model.getValue();

                    if (typeof source === "string" && source.trim()) {
                        return {
                            found: true,
                            method: "Monaco",
                            source,
                            title,
                            description,
                            feedback
                        };
                    }
                }
            }

            const cmContent = document.querySelector(".cm-editor .cm-content");

            if (cmContent) {
                const source = textWithoutMedia(cmContent);

                if (typeof source === "string" && source.trim()) {
                    return {
                        found: true,
                        method: "CodeMirror",
                        source,
                        title,
                        description,
                        feedback
                    };
                }
            }

            for (const textarea of document.querySelectorAll("textarea")) {
                if (
                    textarea.offsetWidth > 0 &&
                    textarea.offsetHeight > 0 &&
                    textarea.value?.trim()
                ) {
                    return {
                        found: true,
                        method: "textarea",
                        source: textarea.value,
                        title,
                        description,
                        feedback
                    };
                }
            }

            for (const element of document.querySelectorAll('[contenteditable="true"]')) {
                if (
                    element.offsetWidth > 0 &&
                    element.offsetHeight > 0 &&
                    textWithoutMedia(element)
                ) {
                    return {
                        found: true,
                        method: "contenteditable",
                        source: textWithoutMedia(element),
                        title,
                        description,
                        feedback
                    };
                }
            }

            return { found: false, reason: "editor not found" };
        });

        if (!value?.found) {
            throw new Error(
                "Could not extract LeetCode editor source: " + value?.reason
            );
        }

        console.log(
            "[LeetCode] source extracted:",
            value.method,
            value.source.length,
            "characters"
        );

        return {
            platform: this.name,
            title: value.title,
            description: value.description,
            feedback: value.feedback,
            source: value.source
        };
    }
};

function parseCodewarsFeedback(text) {
    const normalized = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();

    if (!normalized || !/(?:test\s+results?|passed|failed|expected|actual|error)/i.test(normalized)) {
        return "";
    }

    return normalized.slice(0, 30000);
}

const CodewarsAdapter = {

    name: "Codewars",

    match(url) {
        return CODEWARS_URL.test(url);
    },

    async getContext(tabId) {
        const value = await executePage(tabId, () => {
            const textWithoutMedia = element => {
                if (!element) {
                    return "";
                }

                const copy = element.cloneNode(true);
                copy.querySelectorAll(
                    "img, picture, svg, video, audio, canvas, iframe"
                ).forEach(media => media.remove());
                return copy.innerText?.trim() || "";
            };

            const title =
                textWithoutMedia(document.querySelector("h1")) ||
                document.querySelector('meta[property="og:title"]')?.content?.trim() ||
                document.title.trim();
            const description = textWithoutMedia(
                document.querySelector(".markdown, .description, [class*='description']")
            );
            const feedbackKeywords = [
                "Test Passed",
                "Tests Passed",
                "Test Failed",
                "Tests Failed",
                "Failed",
                "Passed",
                "Error",
                "Expected",
                "Actual"
            ];
            const feedback = [...document.querySelectorAll(
                '[class*="test"], [class*="result"], [class*="output"], [class*="console"]'
            )]
                .map(element => ({
                    text: textWithoutMedia(element),
                    visible: element.offsetWidth > 0 && element.offsetHeight > 0
                }))
                .filter(candidate =>
                    candidate.visible &&
                    candidate.text.length > 0 &&
                    candidate.text.length <= 12000 &&
                    feedbackKeywords.some(keyword => candidate.text.includes(keyword))
                )
                .sort((left, right) => right.text.length - left.text.length)[0]?.text || "";
            const editorCandidates = [
                ...document.querySelectorAll(".CodeMirror .CodeMirror-code"),
                ...document.querySelectorAll(".cm-editor .cm-content"),
                ...document.querySelectorAll("textarea"),
                ...document.querySelectorAll('[contenteditable="true"]')
            ];

            for (const element of editorCandidates) {
                const source = element.value || textWithoutMedia(element);

                if (
                    element.offsetWidth > 0 &&
                    element.offsetHeight > 0 &&
                    typeof source === "string" &&
                    source.trim()
                ) {
                    return {
                        found: true,
                        method: element.matches("textarea")
                            ? "textarea"
                            : "editor",
                        title,
                        description,
                        feedback,
                        source
                    };
                }
            }

            return { found: false, reason: "editor not found" };
        });

        if (!value?.found) {
            throw new Error(
                "Could not extract Codewars editor source: " + value?.reason
            );
        }

        console.log(
            "[Codewars] source extracted:",
            value.method,
            value.source.length,
            "characters"
        );

        return {
            platform: this.name,
            title: value.title,
            description: value.description,
            feedback: [
                value.feedback,
                ...(
                    await executePageAllFrames(tabId, () => {
                        const visible = element =>
                            element &&
                            element.offsetWidth > 0 &&
                            element.offsetHeight > 0;
                        const textOf = element => {
                            const copy = element.cloneNode(true);
                            copy.querySelectorAll(
                                "img, picture, svg, video, audio, canvas, iframe"
                            ).forEach(media => media.remove());
                            return copy.innerText?.trim() || "";
                        };
                        const selectors = [
                            '[class*="test"]',
                            '[class*="result"]',
                            '[class*="output"]',
                            '[class*="console"]',
                            "body"
                        ];
                        const candidates = [];

                        for (const selector of selectors) {
                            for (const element of document.querySelectorAll(selector)) {
                                if (!visible(element)) continue;
                                const text = textOf(element);
                                if (
                                    text &&
                                    text.length <= 30000 &&
                                    /(?:test\s+results?|passed|failed|expected|actual|error)/i.test(text)
                                ) {
                                    candidates.push(text);
                                }
                            }
                        }

                        return candidates;
                    })
                ).flatMap(result => result.result || [])
            ]
                .map(parseCodewarsFeedback)
                .filter(Boolean)
                .sort((left, right) => right.length - left.length)[0] || "",
            source: value.source
        };
    }
};

const SourceFallbackAdapter = {

    name: "Web source",

    match(url) {
        return /^https?:\/\//.test(url);
    },

    async getContext(tabId) {
        const value = await executePage(tabId, async () => {
            const response = await fetch(location.href, {
                credentials: "include"
            });

            return {
                title: document.title.trim() || location.href,
                source: await response.text()
            };
        });

        return {
            platform: this.name,
            title: value.title,
            description: "",
            source: value.source,
            feedback: ""
        };
    }
};

const ExercismOverviewAdapter = {

    name: "Exercism overview",

    match(url) {
        return EXERCISM_OVERVIEW_URL.test(url);
    },

    async markComplete(tabId) {
        return completeExercismExercise(tabId);
    }
};

async function completeExercismExercise(tabId) {
    let markedComplete = false;
    const markStart = performance.now();

    while (performance.now() - markStart < 5000) {
        try {
            markedComplete = await executePage(tabId, () => {
                const button = [...document.querySelectorAll("button")]
                    .find(candidate =>
                        candidate.offsetWidth > 0 &&
                        candidate.offsetHeight > 0 &&
                        !candidate.disabled &&
                        /mark as complete/i.test(
                            candidate.innerText.trim()
                        )
                    );

                if (!button) {
                    return false;
                }

                button.click();
                return true;
            });
        } catch (_) {
            // Submission may navigate directly to the completed page.
            return false;
        }

        if (markedComplete) break;
        await sleep(100);
    }

    if (!markedComplete) {
        return false;
    }

    const confirmStart = performance.now();
    let confirmClicked = false;
    while (performance.now() - confirmStart < 5000) {
        try {
            const result = await executePage(tabId, hasClickedConfirm => {
                const statusNode = document.querySelector(
                    '[data-react-id="student-open-editor-button"]'
                );
                let status = "";

                try {
                    status = JSON.parse(
                        statusNode?.getAttribute("data-react-data") || "{}"
                    ).status || "";
                } catch (_) {}

                const solved = [...document.querySelectorAll("h1, h2, h3, h4")]
                    .some(heading =>
                        heading.offsetWidth > 0 &&
                        heading.offsetHeight > 0 &&
                        /^exercise solved$/i.test(
                            (heading.innerText || heading.textContent || "").trim()
                        )
                    );

                if (status === "completed" || solved) {
                    return "completed";
                }

                const button = [...document.querySelectorAll("button")]
                    .find(candidate =>
                        candidate.offsetWidth > 0 &&
                        candidate.offsetHeight > 0 &&
                        !candidate.disabled &&
                        /^(confirm|complete)$/i.test(
                            candidate.innerText.trim()
                        )
                    );

                if (!button || hasClickedConfirm) {
                    return "waiting";
                }

                button.click();
                return "confirm-clicked";
            }, [confirmClicked]);

            if (result === "completed") return true;
            if (result === "confirm-clicked") confirmClicked = true;
        } catch (_) {
            return false;
        }

        await sleep(100);
    }

    return false;
}