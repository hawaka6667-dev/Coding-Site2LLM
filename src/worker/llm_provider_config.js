/* @machine
file: worker/llm_provider_config.js
role: shared LLM provider metadata and URL matching
contract: service worker and page shortcut bridge use the same provider rules
*/

const DEEPSEEK_URL = /^https:\/\/(chat\.)?deepseek\.com\//;
const LLM_PROVIDERS = [
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

function getLlmProviders(customProviders = []) {
    const providers = [...LLM_PROVIDERS];
    if (!Array.isArray(customProviders)) {
        return providers;
    }

    for (const item of customProviders) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name || typeof item.url !== "string") {
            continue;
        }

        try {
            const target = new URL(item.url);
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

async function getConfiguredLlmProviders() {
    const stored = await chrome.storage?.local?.get?.("customLlmProviders");
    return getLlmProviders(stored?.customLlmProviders);
}