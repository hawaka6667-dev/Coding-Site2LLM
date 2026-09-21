/*
 * Responsibility: website adapters only.
 * Keep Exercism and LeetCode selectors and extraction rules in this file.
 * Functions passed to executePage must not use worker-scope helpers.
 */

const ExercismAdapter = {

    name: "Exercism",

    match(url) {
        return EXERCISM_URL.test(url);
    },

    async testAndSubmit(tabId) {
        const result = await executePage(tabId, () => {
            const buttons = [...document.querySelectorAll("button")]
                .filter(button =>
                    button.offsetWidth > 0 &&
                    button.offsetHeight > 0 &&
                    !button.disabled
                );
            const textOf = button => button.innerText.trim().toLowerCase();
            const testButton = buttons.find(button =>
                /run tests?|test/.test(textOf(button))
            );

            if (!testButton) {
                return { ok: false, reason: "Exercism test button not found." };
            }

            testButton.click();
            return { ok: true };
        });

        if (!result?.ok) {
            throw new Error(result?.reason || "Could not start Exercism tests.");
        }

        const continueStart = performance.now();
        while (performance.now() - continueStart < 5000) {
            const continued = await executePage(tabId, () => {
                const button = [...document.querySelectorAll("button")]
                    .find(candidate =>
                        candidate.offsetWidth > 0 &&
                        candidate.offsetHeight > 0 &&
                        !candidate.disabled &&
                        /continue without waiting/.test(
                            candidate.innerText.trim().toLowerCase()
                        )
                    );

                if (!button) {
                    return false;
                }

                button.click();
                return true;
            });

            if (continued) break;
            await sleep(100);
        }

        const submitted = await executePage(tabId, () => {
            const buttons = [...document.querySelectorAll("button")]
                .filter(button =>
                    button.offsetWidth > 0 &&
                    button.offsetHeight > 0 &&
                    !button.disabled
                );
            const submitButton = buttons.find(button =>
                /submit/.test(button.innerText.trim().toLowerCase())
            );

            if (!submitButton) {
                return { ok: false, reason: "Exercism submit button not found." };
            }

            submitButton.click();
            return { ok: true };
        });

        if (!submitted?.ok) {
            throw new Error(submitted?.reason || "Could not submit Exercism solution.");
        }

        const overviewUrl = await waitForExercismOverview(tabId);
        if (overviewUrl) {
            await ExercismOverviewAdapter.markComplete(tabId);
        }
    },

    async getContext(tabId) {
        const value = await executePage(tabId, () => {
            const editor = document.querySelector('[data-react-id="editor"]');

            if (editor) {
                const raw = editor.getAttribute("data-react-data");

                if (raw) {
                    try {
                        const data = JSON.parse(raw);
                        const files = data.default_files;

                        if (Array.isArray(files) && files.length > 0) {
                            return { found: true, method: "Exercism data", files };
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
                        files: [{ filename: "current-source", content: source }]
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
            feedback: value.feedback,
            source: value.source
        };
    }
};

const ExercismOverviewAdapter = {

    name: "Exercism overview",

    match(url) {
        return EXERCISM_OVERVIEW_URL.test(url);
    },

    async markComplete(tabId) {
        await completeExercismExercise(tabId);
    }
};

async function waitForExercismOverview(tabId, timeout = 10000) {
    const start = performance.now();

    while (performance.now() - start < timeout) {
        try {
            const url = await executePage(tabId, () => window.location.href);
            if (EXERCISM_OVERVIEW_URL.test(url)) {
                return url;
            }
        } catch (_) {
            // The tab may be between the editor and overview documents.
        }

        await sleep(100);
    }

    return "";
}

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
            return;
        }

        if (markedComplete) break;
        await sleep(100);
    }

    if (!markedComplete) {
        return;
    }

    const confirmStart = performance.now();
    while (performance.now() - confirmStart < 5000) {
        try {
            const confirmed = await executePage(tabId, () => {
                const button = [...document.querySelectorAll("button")]
                    .find(candidate =>
                        candidate.offsetWidth > 0 &&
                        candidate.offsetHeight > 0 &&
                        !candidate.disabled &&
                        /^(confirm|complete)$/i.test(
                            candidate.innerText.trim()
                        )
                    );

                if (!button) {
                    return false;
                }

                button.click();
                return true;
            });

            if (confirmed) return;
        } catch (_) {
            return;
        }

        await sleep(100);
    }
}