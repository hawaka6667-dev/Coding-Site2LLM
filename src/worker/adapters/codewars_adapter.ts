/* @machine
file: worker/adapters/codewars_adapter.ts
role: own the codewars adapter site adapter
*/

function parseCodewarsFeedback(text: string) {
    const normalized = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();

    if (!normalized || !/(?:test\s+results?|passed|failed|expected|actual|error)/i.test(normalized)) {
        return "";
    }

    return normalized.slice(0, 30000);
}

const CodewarsAdapter: CodingSiteAdapter = {

    name: "Codewars",

    match(url) {
        return CODEWARS_URL.test(url);
    },

    async replaceCode(tabId, text) {
        const replaced = await executePage(tabId, value => {
            const editor = document.querySelector("#code .js-editor .CodeMirror")?.CodeMirror;

            if (!editor || typeof editor.setValue !== "function") {
                return false;
            }

            editor.setValue(value);
            editor.focus();
            return editor.getValue() === value;
        }, [text]);

        if (replaced !== true) {
            throw new Error("Could not replace code in the Codewars solution editor.");
        }
    },

    async testAndSubmit(tabId) {
        const submitted = await executePage(tabId, () => {
            const attempt = document.querySelector("#attempt_btn");

            if (!attempt || attempt.offsetWidth === 0 || attempt.offsetHeight === 0) {
                return false;
            }

            attempt.click();
            return true;
        });

        if (submitted !== true) {
            throw new Error("Could not find the Codewars Attempt button.");
        }
    },

    async getContext(tabId) {
        const value = await executePage(tabId, () => {
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
                        const visible = (element: Element) =>
                            element &&
                            element.offsetWidth > 0 &&
                            element.offsetHeight > 0;
                        const textOf = (element: Element) => {
                            const copy = element.cloneNode(true) as HTMLElement;
                            copy.querySelectorAll(
                                "img, picture, svg, video, audio, canvas, iframe"
                            ).forEach((media: Element) => media.remove());
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
