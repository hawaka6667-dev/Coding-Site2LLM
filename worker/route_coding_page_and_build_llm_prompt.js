/* @machine
file: worker/route_coding_page_and_build_llm_prompt.js
role: map page URL to adapter and assemble captured fields
contract: no generated instructions or prompt prose
*/

const PLATFORMS = [
    ExercismAdapter,
    ExercismOverviewAdapter,
    LeetCodeAdapter,
    CodewarsAdapter
];

function cleanLeetCodeDescription(text) {
    return String(text || "")
        .replace(/Can\s+you\s+solve\s+this\s+real\s+interview\s+question\?\s*/i, "")
        .replace(/(?:^|\n)\s*Beats\s+\d+(?:\.\d+)?%[^\n]*(?:\n|$)/gi, "\n")
        .replace(/\s+/g, " ")
        .split(/Questions\s+you\s+should\s+ask\s+yourself|Editorial/i)[0]
        .trim();
}

function cleanLeetCodeFeedback(text) {
    return String(text || "")
        .split(/\r?\n/)
        .map(line => line.replace(/\s+Beats\b.*$/i, "").trim())
        .filter(line => line && !/^Beats\b/i.test(line))
        .join("\n");
}

function getPlatform(url) {
    if (isViewSourceUrl(url)) {
        throw new Error(
            "Open the normal Exercism page instead of view-source:; Chrome does not allow extensions to attach to view-source pages."
        );
    }

    const normalizedUrl = pageUrl(url);
    const platform = PLATFORMS.find(item => item.match(normalizedUrl));

    if (!platform) {
        throw new Error(
            "Current page is not a supported coding exercise page."
        );
    }

    return platform;
}

function buildPrompt(context) {
    const sections = [
        context.title || "",
        context.platform === "LeetCode"
            ? cleanLeetCodeDescription(context.description)
            : context.description || "",
        context.platform === "LeetCode"
            ? cleanLeetCodeFeedback(context.feedback)
            : context.feedback || "",
        context.source || ""
    ];

    return sections.filter(Boolean).join("\n\n");
}

function diagnoseContext(context) {
    const fields = ["title", "description", "source", "language", "feedback"];
    const values = Object.fromEntries(fields.map(field => {
        const value = typeof context?.[field] === "string"
            ? context[field].trim()
            : "";

        return [field, { present: Boolean(value), length: value.length }];
    }));

    return {
        platform: context?.platform || "unknown",
        fields: values
    };
}