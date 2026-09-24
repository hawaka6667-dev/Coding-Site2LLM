/* @machine
file: popup/popup.js
role: own popup actions and persist user settings
contract: default_popup owns send; sync Exercism redirect key with overview script
*/
const EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY =
    "exercismOpenNewExerciseInEditor";
const SELECTED_LLM_PROVIDER_KEY = "selectedLlmProvider";
const DAILY_PRACTICE_CUSTOM_PROVIDERS_KEY = "dailyPracticeCustomProviders";
const DEFAULT_LLM_PROVIDER = "DeepSeek";
const SHORTCUTS_KEY = "codingSite2LlmShortcuts";
const DEFAULT_SEND_CONTEXT_SHORTCUT = "Alt+Q";

const toggle = document.getElementById("exercism-open-new-exercise-in-editor");
const providerSelect = document.getElementById("llm-provider");
const sendButton = document.getElementById("send-context");
const status = document.getElementById("status");
const dailyPracticeList = document.getElementById("daily-practice-links");
const dailyPracticeAddButton = document.getElementById("daily-practice-add");
const dailyPracticeOpenAllButton = document.getElementById("daily-practice-open-all");
const dailyPracticeForm = document.getElementById("daily-practice-form");
const dailyPracticeUrlInput = document.getElementById("daily-practice-url");
const dailyPracticeCancelButton = document.getElementById("daily-practice-cancel");

let statusTimer = 0;
let customDailyPracticeProviders = [];

function getDailyPracticeLabel(hostname) {
    const host = hostname.replace(/^www\./i, "").toLowerCase();
    const knownLabels = {
        "atcoder.jp": "AtCoder",
        "codeforces.com": "Codeforces",
        "codewars.com": "Codewars",
        "exercism.org": "Exercism",
        "hackerearth.com": "HackerEarth",
        "hackerrank.com": "HackerRank",
        "leetcode.com": "LeetCode"
    };

    if (knownLabels[host]) {
        return knownLabels[host];
    }

    return host.split(".")[0]
        .split(/[-_]/)
        .map(part => part ? part[0].toUpperCase() + part.slice(1) : "")
        .join(" ");
}

function parseDailyPracticeUrl(value) {
    try {
        const input = value.trim();
        const url = new URL(
            /^https?:\/\//i.test(input) ? input : `https://${input}`
        );
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }

        return {
            id: url.href,
            label: getDailyPracticeLabel(url.hostname),
            url: url.href
        };
    } catch (_) {
        return null;
    }
}

function getDailyPracticeProviders() {
    return [
        ...DAILY_PRACTICE_PROVIDERS.map(provider => ({
            id: provider.id,
            label: provider.label,
            getUrl: () => provider.getUrl(),
            removable: false
        })),
        ...customDailyPracticeProviders.map(provider => ({
            ...provider,
            getUrl: () => provider.url,
            removable: true
        }))
    ];
}

function renderDailyPracticeProviders() {
    dailyPracticeList.replaceChildren();

    for (const provider of getDailyPracticeProviders()) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "daily-practice-button";
        button.textContent = provider.label;
        button.title = `Open ${provider.label}`;
        button.addEventListener("click", () => {
            chrome.tabs.create({ url: provider.getUrl() });
        });
        item.append(button);

        if (provider.removable) {
            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "daily-practice-remove";
            removeButton.textContent = "x";
            removeButton.setAttribute("aria-label", `Remove ${provider.label}`);
            removeButton.title = `Remove ${provider.label}`;
            removeButton.addEventListener("click", async () => {
                customDailyPracticeProviders = customDailyPracticeProviders.filter(
                    savedProvider => savedProvider.id !== provider.id
                );
                await chrome.storage.local.set({
                    [DAILY_PRACTICE_CUSTOM_PROVIDERS_KEY]: customDailyPracticeProviders
                });
                renderDailyPracticeProviders();
            });
            item.append(removeButton);
        }

        dailyPracticeList.append(item);
    }
}

async function loadCustomDailyPracticeProviders() {
    const stored = await chrome.storage.local.get(DAILY_PRACTICE_CUSTOM_PROVIDERS_KEY);
    customDailyPracticeProviders = Array.isArray(
        stored[DAILY_PRACTICE_CUSTOM_PROVIDERS_KEY]
    ) ? stored[DAILY_PRACTICE_CUSTOM_PROVIDERS_KEY] : [];
    renderDailyPracticeProviders();
}

dailyPracticeAddButton.addEventListener("click", () => {
    dailyPracticeForm.hidden = false;
    dailyPracticeUrlInput.focus();
});

dailyPracticeCancelButton.addEventListener("click", () => {
    dailyPracticeForm.reset();
    dailyPracticeForm.hidden = true;
});

dailyPracticeUrlInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") {
        return;
    }

    event.preventDefault();
    dailyPracticeForm.requestSubmit();
});

dailyPracticeForm.addEventListener("submit", async event => {
    event.preventDefault();
    const provider = parseDailyPracticeUrl(dailyPracticeUrlInput.value);

    if (!provider) {
        showStatus("Enter a valid http or https URL.", true);
        return;
    }

    const existingUrls = new Set(
        getDailyPracticeProviders().map(item => item.getUrl())
    );
    if (existingUrls.has(provider.url)) {
        showStatus("That practice URL is already in the list.");
        return;
    }

    customDailyPracticeProviders.push(provider);
    await chrome.storage.local.set({
        [DAILY_PRACTICE_CUSTOM_PROVIDERS_KEY]: customDailyPracticeProviders
    });
    dailyPracticeForm.reset();
    dailyPracticeForm.hidden = true;
    renderDailyPracticeProviders();
});

dailyPracticeOpenAllButton.addEventListener("click", async () => {
    const providers = getDailyPracticeProviders();
    dailyPracticeOpenAllButton.disabled = true;
    try {
        await Promise.all(providers.map(provider =>
            chrome.tabs.create({ url: provider.getUrl() })
        ));
        showStatus(`Opened ${providers.length} daily practice sites.`);
    } catch (error) {
        showStatus("Could not open all practice sites: " + (error?.message || error), true);
    } finally {
        dailyPracticeOpenAllButton.disabled = false;
    }
});

async function renderShortcut() {
    const stored = await chrome.storage.local.get(SHORTCUTS_KEY);
    const shortcuts = stored[SHORTCUTS_KEY] || {};
    const value = shortcuts["send-context"] ?? shortcuts["run-workflow"] ?? DEFAULT_SEND_CONTEXT_SHORTCUT;
    sendButton.textContent = `Send context to LLM (${value || "None"})`;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SHORTCUTS_KEY]) {
        renderShortcut().catch(() => {});
    }
});

function showStatus(text, sticky = false) {
    status.textContent = text;
    clearTimeout(statusTimer);

    if (!sticky) {
        statusTimer = setTimeout(() => {
            status.textContent = "";
        }, 4000);
    }
}

async function renderToggle() {
    const stored = await chrome.storage.local.get(
        EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY
    );

    // Unset means the feature is on; the default lives in the content script.
    toggle.checked =
        stored[EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY] !== false;
}

async function renderProvider() {
    const stored = await chrome.storage.local.get(SELECTED_LLM_PROVIDER_KEY);
    const value = stored[SELECTED_LLM_PROVIDER_KEY] || DEFAULT_LLM_PROVIDER;

    providerSelect.value = [...providerSelect.options].some(option =>
        option.value === value
    ) ? value : DEFAULT_LLM_PROVIDER;
}

providerSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({
        [SELECTED_LLM_PROVIDER_KEY]: providerSelect.value
    });
});

toggle.addEventListener("change", async () => {
    await chrome.storage.local.set({
        [EXERCISM_OPEN_NEW_EXERCISE_IN_EDITOR_SETTING_KEY]: toggle.checked
    });

    showStatus(toggle.checked ? "Enabled" : "Disabled");
});

sendButton.addEventListener("click", async () => {
    sendButton.disabled = true;
    showStatus("Sending…", true);

    try {
        const response = await chrome.runtime.sendMessage({
            type: "run-workflow"
        });

        if (!response?.ok) {
            throw new Error(response?.error || "The workflow did not report success.");
        }

        showStatus("Sent to the LLM tab.");
    } catch (error) {
        showStatus("Failed: " + (error?.message || error), true);
    } finally {
        sendButton.disabled = false;
    }
});

renderToggle();
renderProvider();
renderShortcut();
loadCustomDailyPracticeProviders();
