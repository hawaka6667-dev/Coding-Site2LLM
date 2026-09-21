/*
 * Responsibility: shared worker configuration only.
 * Keep URL matching, provider metadata, and input selectors here.
 */

const EXERCISM_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/edit(?:[/?#]|$)/;

const EXERCISM_OVERVIEW_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

const LEETCODE_URL =
    /^https:\/\/leetcode\.com\/problems\/[^/]+\/?/;

const CODEWARS_URL =
    /^https:\/\/(?:www\.)?codewars\.com\/kata\/[^/?#]+(?:[/?#]|$)/;

const DEEPSEEK_URL =
    /^https:\/\/(chat\.)?deepseek\.com\//;

const LLM_PROVIDERS = [
    {
        name: "DeepSeek",
        url: "https://chat.deepseek.com/",
        match: url => DEEPSEEK_URL.test(url)
    },
    {
        name: "ChatGPT",
        match: url => /^https:\/\/(chat\.)?openai\.com\//.test(url) ||
            /^https:\/\/chatgpt\.com\//.test(url)
    },
    {
        name: "Claude",
        match: url => /^https:\/\/claude\.ai\//.test(url)
    },
    {
        name: "Gemini",
        match: url => /^https:\/\/gemini\.google\.com\//.test(url)
    },
    {
        name: "DeepAI",
        match: url => /^https:\/\/(www\.)?deepai\.org\//.test(url)
    }
];

const INPUT_SELECTORS = [
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]'
];