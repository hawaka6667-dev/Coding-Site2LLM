/* @machine
file: worker/workflows/smart_return/route_lifecycle.js
role: connect Smart Return route state to copy and tab lifecycle events
contract: ignore stale navigation events and guard copied payload updates by route revision
*/

namespace SmartReturn {
    function invalidateRouteForUrl(tabId: number, url: string) {
        if (!Number.isInteger(tabId) || typeof url !== "string") {
            return;
        }

        chrome.tabs.get(tabId)
            .then(tab => tab.url === url && routes.invalidateSourceUrlChange(tabId, url))
            .catch(error => {
                console.error("[smart-return] route invalidation ERROR:", error);
            });
    }

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
        chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
            if (typeof changeInfo.url === "string") {
                invalidateRouteForUrl(tabId, changeInfo.url);
            }
        });

        chrome.webNavigation?.onHistoryStateUpdated?.addListener(details => {
            if (details.frameId === 0) {
                invalidateRouteForUrl(details.tabId, details.url);
            }
        });

        chrome.webNavigation?.onReferenceFragmentUpdated?.addListener(details => {
            if (details.frameId === 0) {
                invalidateRouteForUrl(details.tabId, details.url);
            }
        });

        chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
            routes.removeTab(tabId, removeInfo.windowId).catch(error => {
                console.error("[smart-return] route cleanup ERROR:", error);
            });
        });
    }
}

SmartReturn.registerRouteLifecycle();