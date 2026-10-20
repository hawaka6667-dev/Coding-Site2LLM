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

type LlmProvider = {
    name: string;
    url: string;
    match: (url: string) => boolean;
};

declare const LLM_PROVIDERS: LlmProvider[];
declare function getLlmProviders(customProviders?: unknown): LlmProvider[];
declare function getConfiguredLlmProviders(): Promise<LlmProvider[]>;

const INPUT_SELECTORS: string[] = [
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]'
];