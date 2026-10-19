/* @machine
file: worker/workflows/smart_return/target_control.js
role: expose the Smart Return target tab for inspection and manual change
contract: resolve the LLM tab from the active tab; mutate routes only through RouteStore
*/

namespace SmartReturn {
    export interface TargetTab {
        tabId: number;
        title: string;
        url: string;
    }

    export interface TargetState {
        llmTabId: number | null;
        target: TargetTab | null;
        candidates: TargetTab[];
    }

    const isLlmTab = (tab: chrome.tabs.Tab) =>
        LLM_PROVIDERS.some(provider => provider.match(tab.url || ""));

    const toTargetTab = (tab: chrome.tabs.Tab): TargetTab => ({
        tabId: tab.id as number,
        title: tab.title || "",
        url: tab.url || ""
    });

    function resolveLlmTab(
        tabs: chrome.tabs.Tab[],
        routeList: Route[],
        activeTabId: number | undefined
    ) {
        const llmTabs = tabs.filter(isLlmTab);
        const active = llmTabs.find(tab => tab.id === activeTabId);
        if (active) {
            return active;
        }

        const routeFromActive = routeList.find(route => route.sourceTabId === activeTabId);
        const routed = llmTabs.find(tab => tab.id === routeFromActive?.llmTabId);
        if (routed) {
            return routed;
        }

        return llmTabs.length === 1 ? llmTabs[0] : null;
    }

    export async function getTargetState(
        windowId: number,
        activeTabId?: number
    ): Promise<TargetState> {
        const tabs = await chrome.tabs.query({ windowId });
        const routeList = await routes.listForWindow(windowId);
        const llmTab = resolveLlmTab(tabs, routeList, activeTabId);
        const llmTabId = typeof llmTab?.id === "number" ? llmTab.id : null;
        const route = routeList.find(item => item.llmTabId === llmTabId);
        const targetTab = tabs.find(tab => tab.id === route?.sourceTabId);

        return {
            llmTabId,
            target: targetTab ? toTargetTab(targetTab) : null,
            candidates: tabs
                .filter(tab =>
                    typeof tab.id === "number" &&
                    tab.id !== llmTabId &&
                    /^https?:\/\//i.test(tab.url || "") &&
                    !isLlmTab(tab)
                )
                .map(toTargetTab)
        };
    }

    export async function setTarget(llmTabId: number, sourceTabId: number) {
        const llmTab = await chrome.tabs.get(llmTabId);
        const sourceTab = await chrome.tabs.get(sourceTabId);
        if (!llmTab || !sourceTab || llmTab.windowId !== sourceTab.windowId) {
            throw new Error("The target tab must be in the same window as the LLM tab.");
        }

        const url = sourceTab.url || "";
        let platformName = "";
        try {
            platformName = getPlatform(url).name;
        } catch (_) {
            platformName = "";
        }

        const source = {
            sourceTabId,
            sourceUrl: url,
            sourcePlatform: platformName,
            sourceIdentity: getCodingPageIdentity(url, platformName),
            status: "routed"
        };
        const route = await routes.get(llmTab.windowId, llmTabId);
        const saved = route
            ? await routes.updateIfCurrent(route, source)
            : await routes.save({
                windowId: llmTab.windowId,
                llmTabId,
                copied: false,
                copiedText: "",
                ...source
            });

        if (!saved) {
            throw new Error("The route changed while updating; try again.");
        }
    }

    // Returns true when the message was handled asynchronously, null otherwise.
    export function handleTargetMessage(
        message: any,
        sendResponse: (response: unknown) => void
    ) {
        if (message?.type === "smart-return-get-target") {
            getTargetState(message.windowId, message.activeTabId)
                .then(state => sendResponse({ ok: true, ...state }))
                .catch(error => sendResponse({
                    ok: false,
                    error: String(error?.message || error)
                }));
            return true;
        }

        if (message?.type === "smart-return-set-target") {
            setTarget(message.llmTabId, message.sourceTabId)
                .then(() => sendResponse({ ok: true }))
                .catch(error => sendResponse({
                    ok: false,
                    error: String(error?.message || error)
                }));
            return true;
        }

        return null;
    }
}
