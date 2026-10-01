/* @machine
file: worker/workflows/smart_return/code_transfer.js
role: read LLM clipboard content and write/submit code on coding tabs
contract: use the site adapter when it owns editor replacement or submission
*/

namespace SmartReturn {
    export async function readClipboard(tabId: number) {
        return executePage(tabId, async () => {
            try {
                return (await navigator.clipboard.readText()).trim();
            } catch (_) {
                return "";
            }
        });
    }

    export function isLikelyCode(text: string) {
        const value = String(text || "").trim();

        if (!value || value.length < 3 || value.length > 100000) {
            return false;
        }

        return /(?:[{};]|=>|\b(?:const|let|var|function|return|class|def|import|from|public|private|if|for|while)\b|<!--[\s\S]*-->|^\s*#include\b)/m.test(value);
    }

    export async function replaceCode(tabId: number, text: string) {
        const sourceTab = await chrome.tabs.get?.(tabId);
        const platform = sourceTab?.url ? getPlatform(sourceTab.url) : null;

        if (typeof platform?.replaceCode === "function") {
            await platform.replaceCode(tabId, text);
            return;
        }

        const replaced = await executePage(tabId, value => {
            if (window.monaco?.editor) {
                const model = window.monaco.editor.getModels()[0];

                if (model) {
                    model.setValue(value);
                    return true;
                }
            }

            const input = document.querySelector(
                '.cm-editor .cm-content[contenteditable="true"], textarea, [contenteditable="true"]'
            );

            if (!input || input.offsetWidth === 0 || input.offsetHeight === 0) {
                return false;
            }

            input.focus();

            if (input.isContentEditable) {
                document.execCommand("selectAll", false);
                if (!document.execCommand("insertText", false, value)) {
                    input.textContent = value;
                }
            } else {
                const prototype = Object.getPrototypeOf(input);
                const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
                if (descriptor?.set) {
                    descriptor.set.call(input, value);
                } else {
                    input.value = value;
                }
            }

            input.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: value
            }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }, [text]);

        if (replaced !== true) {
            throw new Error("Could not replace code in the coding page editor.");
        }
    }

    export async function submitReturnedCode(tabId: number) {
        const sourceTab = await chrome.tabs.get?.(tabId);
        const platform = sourceTab?.url ? getPlatform(sourceTab.url) : null;

        if (typeof platform?.testAndSubmit === "function") {
            await platform.testAndSubmit(tabId);
            return;
        }

        await executePage(tabId, () => {
            const target = document.activeElement || document;

            for (const type of ["keydown", "keyup"]) {
                target.dispatchEvent(new KeyboardEvent(type, {
                    key: "Enter",
                    code: "Enter",
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true
                }));
            }
        });
    }
}