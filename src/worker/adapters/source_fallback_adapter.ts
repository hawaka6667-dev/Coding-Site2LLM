/* @machine
file: worker/adapters/source_fallback_adapter.ts
role: own the source fallback adapter site adapter
*/

const SourceFallbackAdapter: CodingSiteAdapter = {

    name: "Web source",

    match(url) {
        return /^https?:\/\//.test(url);
    },

    async getContext(tabId) {
        const value = await executePage(tabId, async () => {
            const response = await fetch(location.href, {
                credentials: "include"
            });
            const source = await response.text();
            const contentType = response.headers?.get("content-type") || "";

            if (!/text\/html/i.test(contentType)) {
                return {
                    title: document.title.trim() || location.href,
                    source
                };
            }

            const parsed = new DOMParser().parseFromString(source, "text/html");
            parsed.querySelectorAll(
                "script, style, template, noscript, svg"
            ).forEach(element => element.remove());
            const text = (parsed.body?.innerText || parsed.body?.textContent || "")
                .replace(/\r\n?/g, "\n")
                .replace(/[ \t]+\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();

            return {
                title: document.title.trim() || location.href,
                source: text
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
