/*
 * @deprecated Legacy HTTP remote-debugging smoke test.
 * Use Chrome DevTools MCP for live page probes instead.
 *
 * Browser smoke test for website adapters.
 *
 * Keep this test focused on page-side selectors and editor availability. The
 * extension workflow itself is covered by tests/unit-routing.test.js.
 *
 * This legacy test requires Chrome's HTTP remote-debugging endpoint. Start
 * Chrome with remote debugging enabled, then run:
 *   node tests/browser-smoke.test.js
 *
 * Optional:
 *   node tests/browser-smoke.test.js --port 9222 --json
 *   node tests/browser-smoke.test.js --platform Codewars
 *   node tests/browser-smoke.test.js --all
 */

const EXERCISM_URL =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/]+\/edit/;

const LEETCODE_URL =
    /^https:\/\/leetcode\.com\/problems\/[^/]+\/?/;

const CODEWARS_URL =
    /^https:\/\/(?:www\.)?codewars\.com\/kata\/[^/?#]+(?:[/?#]|$)/;

const DEEPSEEK_URL =
    /^https:\/\/(chat\.)?deepseek\.com\//;

const portArgumentIndex = process.argv.indexOf("--port");
const port = Number(
    portArgumentIndex === -1
        ? 9222
        : process.argv[portArgumentIndex + 1]
);
const jsonOutput = process.argv.includes("--json");
const allTargets = process.argv.includes("--all");
const platformArgumentIndex = process.argv.indexOf("--platform");
const requestedPlatform = platformArgumentIndex === -1
    ? null
    : process.argv[platformArgumentIndex + 1];

function now() {
    return performance.now();
}

function pageExpression(platform) {
    if (platform === "Exercism") {
        return `
            (() => {
                const editor = document.querySelector('[data-react-id="editor"]');
                if (editor) {
                    const raw = editor.getAttribute("data-react-data");
                    if (raw) {
                        try {
                            const files = JSON.parse(raw).default_files;
                            if (Array.isArray(files) && files.length > 0) {
                                return { found: true, method: "Exercism data", files: files.length };
                            }
                        } catch (_) {
                            // Try the rendered editor below.
                        }
                    }
                }

                for (const element of [
                    ...document.querySelectorAll(".cm-content"),
                    ...document.querySelectorAll("textarea"),
                    ...document.querySelectorAll('[contenteditable="true"]')
                ]) {
                    const source = element.value || element.innerText || element.textContent;
                    if (
                        element.offsetWidth > 0 &&
                        element.offsetHeight > 0 &&
                        typeof source === "string" &&
                        source.trim()
                    ) {
                        return { found: true, method: "rendered editor", characters: source.length };
                    }
                }

                return { found: false, reason: "Exercism editor is not rendered yet" };
            })()
        `;
    }

    if (platform === "LeetCode") {
        return `
            (() => {
                if (window.monaco?.editor) {
                    for (const model of window.monaco.editor.getModels()) {
                        const source = model.getValue();
                        if (typeof source === "string" && source.trim()) {
                            return { found: true, method: "Monaco", characters: source.length };
                        }
                    }
                }

                const cmContent = document.querySelector(".cm-editor .cm-content");
                if (
                    cmContent &&
                    cmContent.offsetWidth > 0 &&
                    cmContent.offsetHeight > 0 &&
                    cmContent.innerText.trim()
                ) {
                    return { found: true, method: "CodeMirror", characters: cmContent.innerText.length };
                }

                for (const textarea of document.querySelectorAll("textarea")) {
                    if (
                        textarea.offsetWidth > 0 &&
                        textarea.offsetHeight > 0 &&
                        textarea.value?.trim()
                    ) {
                        return { found: true, method: "textarea", characters: textarea.value.length };
                    }
                }

                return { found: false, reason: "editor not found" };
            })()
        `;
    }

    if (platform === "Codewars") {
        return `
            (() => {
                const visible = element =>
                    element && element.offsetWidth > 0 && element.offsetHeight > 0;
                const source = element => element.value || element.innerText || element.textContent || "";
                const editors = [
                    ...document.querySelectorAll(".CodeMirror .CodeMirror-code"),
                    ...document.querySelectorAll(".cm-editor .cm-content"),
                    ...document.querySelectorAll("textarea"),
                    ...document.querySelectorAll('[contenteditable="true"]')
                ];

                for (const editor of editors) {
                    const text = source(editor);
                    if (visible(editor) && text.trim()) {
                        return { found: true, method: "Codewars editor", characters: text.length };
                    }
                }

                return { found: false, reason: "Codewars editor is not rendered yet" };
            })()
        `;
    }

    return `
        (() => {
            const selectors = [
                "textarea",
                '[contenteditable="true"]',
                '[role="textbox"]'
            ];

            for (const selector of selectors) {
                for (const element of document.querySelectorAll(selector)) {
                    if (
                        element.offsetWidth > 0 &&
                        element.offsetHeight > 0
                    ) {
                        return { found: true, selector };
                    }
                }
            }

            return { found: false, reason: "input not found" };
        })()
    `;
}

async function getTargets() {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) {
        throw new Error(`Chrome returned HTTP ${response.status}`);
    }

    return (await response.json()).filter(target => target.type === "page");
}

function evaluate(target, expression) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        let commandId = 0;

        const timer = setTimeout(() => {
            socket.close();
            reject(new Error("CDP evaluation timed out"));
        }, 5000);

        socket.addEventListener("open", () => {
            commandId = 1;
            socket.send(JSON.stringify({
                id: commandId,
                method: "Runtime.evaluate",
                params: { expression, returnByValue: true }
            }));
        });

        socket.addEventListener("message", event => {
            const message = JSON.parse(event.data);
            if (message.id !== commandId) return;

            clearTimeout(timer);
            socket.close();

            if (message.error || message.result?.exceptionDetails) {
                reject(new Error(
                    message.error?.message ||
                    message.result.exceptionDetails.exception?.description ||
                    message.result.exceptionDetails.text ||
                    "Runtime.evaluate failed"
                ));
                return;
            }

            resolve(message.result.result.value);
        });

        socket.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error("Could not connect to the tab's CDP socket"));
        });
    });
}

async function testPlatform(platform, target) {
    const started = now();
    const result = {
        platform,
        url: target.url,
        ok: false,
        delayMs: 0
    };

    try {
        const pageResult = await evaluate(target, pageExpression(platform));
        result.ok = pageResult?.found === true;
        result.details = pageResult?.found
            ? pageResult
            : { reason: pageResult?.reason || "unknown failure" };
    } catch (error) {
        result.details = { reason: error.message };
    }

    result.delayMs = Math.round(now() - started);
    return result;
}

function platformFor(url) {
    if (EXERCISM_URL.test(url)) return "Exercism";
    if (LEETCODE_URL.test(url)) return "LeetCode";
    if (CODEWARS_URL.test(url)) return "Codewars";
    if (DEEPSEEK_URL.test(url)) return "DeepSeek";
    return null;
}

function printResults(results) {
    if (jsonOutput) {
        console.log(JSON.stringify({ port, results }, null, 2));
        return;
    }

    console.log(`Chrome CDP port: ${port}`);
    for (const result of results) {
        const state = result.ok ? "PASS" : "FAIL";
        const detail = result.ok
            ? JSON.stringify(result.details)
            : result.details.reason;
        console.log(
            `[${state}] ${result.platform} - ${result.delayMs} ms - ${detail}`
        );
    }
}

async function main() {
    let targets;
    try {
        targets = await getTargets();
    } catch (error) {
        console.error(
            `Cannot connect to Chrome on port ${port}. ` +
            "Start Chrome with --remote-debugging-port, then retry."
        );
        console.error(error.message);
        process.exitCode = 2;
        return;
    }

    const selected = targets
        .map(target => ({ target, platform: platformFor(target.url || "") }))
        .filter(item =>
            item.platform &&
            (!requestedPlatform || item.platform === requestedPlatform)
        );

    if (selected.length === 0) {
        console.error(
            "No supported page found. Open Exercism, LeetCode, Codewars, or DeepSeek first."
        );
        process.exitCode = 1;
        return;
    }

    const results = [];
    const targetsToCheck = allTargets ? selected : selected.slice(0, 1);
    for (const item of targetsToCheck) {
        results.push(await testPlatform(item.platform, item.target));
    }

    printResults(results);
    if (results.some(result => !result.ok)) process.exitCode = 1;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});