/* @machine
file: popup/daily_practice_providers.js
role: declare popup daily-practice destinations
contract: each provider supplies a stable id, label, and URL resolver
*/
const DAILY_PRACTICE_PROVIDERS = [
    {
        id: "leetcode",
        label: "Leet Daily📅",
        getUrl() {
            const date = new Date().toISOString().slice(0, 10);
            return `https://leetcode.com/problemset/?envType=daily-question&envId=${date}`;
        }
    },
    {
        id: "codewars",
        label: "Codewars",
        getUrl() {
            return "https://www.codewars.com/dashboard";
        }
    },
    {
        id: "neetcode-roadmap",
        label: "Neet Roadmap",
        getUrl() {
            return "https://neetcode.io/roadmap";
        }
    },
    {
        id: "exercism-tracks",
        label: "Exercism language Track",
        getUrl() {
            return "https://exercism.org/tracks";
        }
    }
];