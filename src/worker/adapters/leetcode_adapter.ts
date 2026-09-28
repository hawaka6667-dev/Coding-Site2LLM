/* @machine
file: worker/adapters/leetcode_adapter.ts
role: own the leetcode adapter site adapter
*/

const LeetCodeAdapter: CodingSiteAdapter = {

    name: "LeetCode",

    match(url) {
        return LEETCODE_URL.test(url) || LEETCODE_SUBMISSIONS_URL.test(url);
    },

    async replaceCode(tabId, text) {
        const replaced = await executePage(tabId, async value => {
            const deadline = Date.now() + 5000;

            while (Date.now() < deadline) {
                const monaco = window.monaco?.editor;

                if (monaco) {
                    const editors = typeof monaco.getEditors === "function"
                        ? monaco.getEditors()
                        : [];
                    const activeEditorNode = document.activeElement
                        ?.closest?.(".monaco-editor");
                    const visibleEditors = editors.filter(editor => {
                        const node = editor.getDomNode?.();
                        const bounds = node?.getBoundingClientRect?.();
                        return node?.isConnected !== false && (
                            bounds
                                ? bounds.width > 0 && bounds.height > 0
                                : node?.offsetWidth > 0 && node?.offsetHeight > 0
                        );
                    });
                    const hasWritableModel = (editor: MonacoEditorLike) => {
                        const model = editor.getModel?.();
                        return model && typeof model.setValue === "function";
                    };
                    const focusedEditor = visibleEditors.find(candidate =>
                        candidate.hasTextFocus?.() && hasWritableModel(candidate)
                    );
                    const activeElementEditor = visibleEditors.find(candidate =>
                        candidate.getDomNode?.() === activeEditorNode &&
                        hasWritableModel(candidate)
                    );
                    const writableEditors = visibleEditors.filter(hasWritableModel);
                    const editor = focusedEditor || activeElementEditor ||
                        (writableEditors.length === 1 ? writableEditors[0] : null);
                    const model = editor?.getModel?.() ||
                        (typeof monaco.getEditors !== "function"
                            ? monaco.getModels?.().find(candidate =>
                                typeof candidate.setValue === "function"
                            )
                            : null);

                    if (model) {
                        try {
                            model.setValue(value);
                            editor?.focus?.();
                            if (model.getValue?.() === value) {
                                return true;
                            }
                        } catch (_) {
                            // The editor may be replaced while a problem switch settles.
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 50));
            }

            return false;
        }, [text]);

        if (replaced !== true) {
            throw new Error("Could not replace code in the LeetCode editor.");
        }
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
            let descriptionSource = visibleDescription;

            if (!descriptionSource) {
                const problemSlug = location.pathname.match(
                    /^\/problems\/([^/]+)/
                )?.[1];

                if (problemSlug) {
                    try {
                        const response = await fetch(
                            `/problems/${encodeURIComponent(problemSlug)}/description/`,
                            { credentials: "include" }
                        );

                        if (response.ok) {
                            const html = await response.text();
                            const parsed = new DOMParser().parseFromString(
                                html,
                                "text/html"
                            );
                            const descriptionElement = parsed.querySelector(
                                '[data-track-load="description_content"]'
                            ) || parsed.querySelector('div[class*="description__"]');
                            descriptionSource = descriptionElement?.innerText?.trim() ||
                                descriptionElement?.textContent?.trim() ||
                                "";
                        }
                    } catch (_) {
                    }
                }
            }

            const description = descriptionSource
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
            const cleanFeedback = (text: string) => text
                .split(/\r?\n/)
                .map(line => line.replace(/\s+Beats\b.*$/i, "").trim())
                .filter((line: string) => line && !/^Beats\b/i.test(line))
                .join("\n");
            const submissionFeedback = [...document.querySelectorAll(".flexlayout__tab")]
                .map(panel => {
                    const bounds = panel.getBoundingClientRect();
                    const heading = panel.querySelector("h3");
                    return {
                        panel,
                        heading: heading?.innerText?.trim() || "",
                        visible: bounds.width > 0 && bounds.height > 0
                    };
                })
                .filter(candidate =>
                    candidate.visible &&
                    candidate.heading &&
                    feedbackKeywords.some(keyword =>
                        candidate.heading.includes(keyword)
                    )
                )
                .map(candidate => {
                    const panelText = candidate.panel.innerText || "";
                    const inputStart = panelText.indexOf("Last Executed Input");
                    const input = inputStart < 0
                        ? ""
                        : panelText.slice(inputStart)
                            .split(/\r?\n/)
                            .filter(line => !/^(?:Use Testcase|View more)$/i.test(line.trim()))
                            .join("\n")
                            .trim();
                    return [candidate.heading, input]
                        .filter(Boolean)
                        .join("\n\n")
                        .slice(0, 12000);
                })
                .sort((left, right) => right.length - left.length)[0] || "";
            const feedbackCandidates = [
                ...document.querySelectorAll(
                    '[data-e2e-locator], [class*="result"], [class*="console"]'
                )
            ];
            const pageFeedback = feedbackCandidates
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
            const feedback = submissionFeedback || pageFeedback;

            if (window.monaco && window.monaco.editor) {
                const monaco = window.monaco.editor;
                const editors = typeof monaco.getEditors === "function"
                    ? monaco.getEditors()
                    : [];
                const activeEditorNode = document.activeElement
                    ?.closest?.(".monaco-editor");
                const activeEditor = editors.find(editor =>
                    editor.getDomNode?.() === activeEditorNode
                );
                const visibleEditor = editors.find(editor => {
                    const node = editor.getDomNode?.();
                    return node?.offsetWidth > 0 && node?.offsetHeight > 0;
                });
                const model = activeEditor?.getModel?.() ||
                    visibleEditor?.getModel?.() ||
                    monaco.getModels?.()[0];
                const source = model?.getValue?.();

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
