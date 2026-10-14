/* @machine
file: worker/adapters/adam_math_hhu_adapter.ts
role: extract Adam Math HHU lesson and Lean editor context
*/

const AdamMathHHUAdapter: CodingSiteAdapter = {

    name: "Adam Math HHU",

    match(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname === "adam.math.hhu.de" &&
                /^#\/g\/[^/]+\/[^/]+\/world\//.test(parsed.hash);
        } catch (_) {
            return false;
        }
    },

    async getContext(tabId) {
        const value = await executePage(tabId, () => {
            const normalize = (text: string) => String(text || "")
                .replace(/\r\n?/g, "\n")
                .replace(/[ \t]+\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            const visible = (element: Element) =>
                element.offsetWidth > 0 && element.offsetHeight > 0;
            const textOf = (element: Element | null) =>
                normalize(element?.innerText || element?.textContent || "");
            const instructions = [...document.querySelectorAll(
                ".message.information .markdown"
            )]
                .filter(visible)
                .map(textOf)
                .filter(Boolean);
            const exercise = textOf(document.querySelector(".exercise-statement"));
            const editor = [...document.querySelectorAll(
                ".codeview .monaco-editor"
            )].find(visible);
            const source = editor
                ? normalize([...editor.querySelectorAll(".view-lines .view-line")]
                    .map(line => line.innerText || line.textContent || "")
                    .join("\n"))
                : "";
            const feedback = [...document.querySelectorAll(".font-code.pre-wrap")]
                .filter(visible)
                .map(textOf)
                .sort((left, right) => right.length - left.length)[0] || "";

            return {
                title: textOf(document.querySelector(".app-bar-title")) ||
                    document.title.trim() || location.href,
                description: [...instructions, exercise].filter(Boolean).join("\n\n"),
                source,
                feedback
            };
        });

        return {
            platform: this.name,
            title: value.title,
            description: value.description,
            language: "Lean",
            source: value.source,
            feedback: value.feedback
        };
    }
};