/* @machine
file: worker/configure_supported_coding_sites_and_llm_providers.ts
role: define site URL matches, provider metadata, input selectors
owns: configuration only
*/

const EXERCISM_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/edit(?:[/?#]|$)/;

const EXERCISM_OVERVIEW_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

const LEETCODE_URL =
    /^https:\/\/leetcode\.com\/problems\/[^/?#]+\/?(?:[?#]|$)/;

const LEETCODE_SUBMISSIONS_URL =
    /^https:\/\/leetcode\.com\/problems\/[^/?#]+\/submissions\/[^/?#]+\/?(?:[?#]|$)/;

const CODEWARS_URL =
    /^https:\/\/(?:www\.)?codewars\.com\/kata\/[^/?#]+(?:[/?#]|$)/;

const DEEPSEEK_URL =
    /^https:\/\/(chat\.)?deepseek\.com\//;

type LlmProvider = {
    name: string;
    url: string;
    match: (url: string) => boolean;
};

const LLM_PROVIDERS: LlmProvider[] = [
    {
        name: "DeepSeek",
        url: "https://chat.deepseek.com/",
        match: url => DEEPSEEK_URL.test(url)
    },
    {
        name: "ChatGPT",
        url: "https://chatgpt.com/",
        match: url => /^https:\/\/(chat\.)?openai\.com\//.test(url) ||
            /^https:\/\/chatgpt\.com\//.test(url)
    },
    {
        name: "Claude",
        url: "https://claude.ai/",
        match: url => /^https:\/\/claude\.ai\//.test(url)
    },
    {
        name: "Gemini",
        url: "https://gemini.google.com/",
        match: url => /^https:\/\/gemini\.google\.com\//.test(url)
    },
    {
        name: "DeepAI",
        url: "https://deepai.org/",
        match: url => /^https:\/\/(www\.)?deepai\.org\//.test(url)
    },
    {
        name: "Kimi",
        url: "https://kimi.com/",
        match: url => /^https:\/\/(www\.)?kimi\.com\//.test(url)
    }
];

function getLlmProviders(customProviders: unknown = []): LlmProvider[] {
    const providers = [...LLM_PROVIDERS];
    if (!Array.isArray(customProviders)) {
        return providers;
    }

    for (const item of customProviders) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const savedProvider = item as { name?: unknown; url?: unknown };
        if (typeof savedProvider.name !== "string" ||
            typeof savedProvider.url !== "string") {
            continue;
        }

        const name = savedProvider.name.trim();
        if (!name) {
            continue;
        }

        try {
            const target = new URL(savedProvider.url);
            if (!["http:", "https:"].includes(target.protocol)) {
                continue;
            }

            providers.push({
                name,
                url: target.href,
                match: candidate => {
                    try {
                        return new URL(candidate).origin === target.origin;
                    } catch (_) {
                        return false;
                    }
                }
            });
        } catch (_) {
            // Ignore invalid values from storage.
        }
    }

    return providers;
}

const INPUT_SELECTORS: string[] = [
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]'
];