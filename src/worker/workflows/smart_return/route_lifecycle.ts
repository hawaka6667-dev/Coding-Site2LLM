/* @machine
file: worker/workflows/smart_return/route_lifecycle.js
role: connect Smart Return route state to copy and tab lifecycle events
contract: keep routes bound to tabs and guard copied payload updates by route revision
*/

namespace SmartReturn {
    export async function recordCopy(tabId: number | undefined, text: unknown) {
        if (typeof tabId !== "number" || typeof text !== "string") {
            return;
        }

        const tabs = await chrome.tabs.query({});
        const llmTab = tabs.find(tab =>
            tab.id === tabId && LLM_PROVIDERS.some(provider => provider.match(tab.url || ""))
        );
        const route = llmTab ? await routes.get(llmTab.windowId, tabId) : null;

        if (route) {
            await routes.updateIfCurrent(route, {
                copied: true,
                copiedText: text
            });
        }
    }

    export function registerRouteLifecycle() {
        chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
            routes.removeTab(tabId, removeInfo.windowId).catch(error => {
                console.error("[smart-return] route cleanup ERROR:", error);
            });
        });
    }
}

SmartReturn.registerRouteLifecycle();