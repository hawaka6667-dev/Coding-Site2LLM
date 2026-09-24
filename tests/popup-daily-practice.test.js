const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");

function createElement() {
    const listeners = new Map();
    return {
        children: [],
        hidden: false,
        options: [],
        value: "",
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        append(child) {
            this.children.push(child);
        },
        replaceChildren(...children) {
            this.children = children;
        },
        reset() {
            this.value = "";
        },
        requestSubmit() {
            return this.dispatch("submit");
        },
        setAttribute(name, value) {
            this[name] = value;
        },
        focus() {},
        async dispatch(type, event = {}) {
            return listeners.get(type)?.({ preventDefault() {}, ...event });
        }
    };
}

async function loadPopup() {
    const elements = new Map();
    const storedValues = {};
    const openedTabs = [];
    const getElementById = id => {
        if (!elements.has(id)) {
            elements.set(id, createElement());
        }
        return elements.get(id);
    };
    getElementById("llm-provider").options = [
        { value: "DeepSeek" }, { value: "ChatGPT" }
    ];

    const context = vm.createContext({
        URL,
        console,
        document: { getElementById, createElement },
        chrome: {
            storage: {
                local: {
                    async get(key) {
                        return { [key]: storedValues[key] };
                    },
                    async set(values) {
                        Object.assign(storedValues, values);
                    }
                },
                onChanged: { addListener() {} }
            },
            tabs: {
                async create(details) {
                    openedTabs.push(details);
                }
            },
            runtime: { async sendMessage() { return { ok: true }; } }
        },
        setTimeout: () => 1,
        clearTimeout() {}
    });

    for (const filename of ["popup/daily_practice_providers.js", "popup/popup.js"]) {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT_DIR, filename), "utf8"),
            context,
            { filename }
        );
    }
    await context.loadCustomDailyPracticeProviders();
    return { context, elements, storedValues, openedTabs };
}

test("adds a custom URL with a detected label, then removes it", async () => {
    const { elements, storedValues } = await loadPopup();
    const form = elements.get("daily-practice-form");
    const input = elements.get("daily-practice-url");

    input.value = "https://www.atcoder.jp/contests/abc";
    await form.dispatch("submit");

    const savedProviders = JSON.parse(
        JSON.stringify(storedValues.dailyPracticeCustomProviders)
    );
    assert.equal(savedProviders[0].label, "AtCoder");
    assert.equal(savedProviders[0].url, "https://www.atcoder.jp/contests/abc");
    assert.equal(elements.get("daily-practice-links").children.length, 3);

    const customItem = elements.get("daily-practice-links").children[2];
    await customItem.children[1].dispatch("click");

    assert.equal(storedValues.dailyPracticeCustomProviders.length, 0);
    assert.equal(elements.get("daily-practice-links").children.length, 2);
});

test("opens destinations individually and with the Open all control", async () => {
    const { elements, openedTabs } = await loadPopup();
    const input = elements.get("daily-practice-url");
    input.value = "https://example.org/daily";
    await elements.get("daily-practice-form").dispatch("submit");
    const items = elements.get("daily-practice-links").children;
    for (const item of items) {
        await item.children[0].dispatch("click");
    }
    await elements.get("daily-practice-open-all").dispatch("click");

    assert.equal(openedTabs.length, 6);
    assert.ok(openedTabs.some(tab => tab.url === "https://example.org/daily"));
    assert.ok(openedTabs.some(tab => tab.url.startsWith("https://leetcode.com/")));
    assert.ok(openedTabs.some(tab => tab.url === "https://www.codewars.com/dashboard"));
});

test("rejects non-web URLs", async () => {
    const { context } = await loadPopup();

    assert.equal(context.parseDailyPracticeUrl("javascript:alert(1)"), null);
    assert.equal(context.parseDailyPracticeUrl("not a URL"), null);
});

test("normalizes a bare daily-practice domain to HTTPS", async () => {
    const { context } = await loadPopup();

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.parseDailyPracticeUrl("baidu.com"))),
        {
            id: "https://baidu.com/",
            label: "Baidu",
            url: "https://baidu.com/"
        }
    );
});

test("submits a custom URL when Enter is pressed", async () => {
    const { elements, storedValues } = await loadPopup();
    const input = elements.get("daily-practice-url");

    input.value = "baidu.com";
    await input.dispatch("keydown", { key: "Enter" });

    assert.equal(storedValues.dailyPracticeCustomProviders[0].url, "https://baidu.com/");
});