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
    }
];

const INPUT_SELECTORS: string[] = [
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]'
];