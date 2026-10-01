/* @machine
file: worker/state/return_route_store.js
role: persist return routes and maintain their source-tab identity
contract: a Smart Return may consume only the route revision it captured
*/

let returnRoutes: Record<string, CodingSiteReturnRoute> | null = null;
let returnRouteRevision = 0;
const RETURN_ROUTE_KEY = "codingSite2LlmReturnRoute";
const RETURN_ROUTES_KEY = "codingSite2LlmReturnRoutes";

async function saveReturnRoute(route: CodingSiteReturnRoute) {
    const routes = await loadReturnRoutes();
    const savedRoute = { ...route, routeRevision: ++returnRouteRevision };
    const key = getReturnRouteKey(route.windowId, route.llmTabId);
    routes[key] = savedRoute;
    await persistReturnRoutes(routes);
    return savedRoute;
}

async function saveReturnRouteIfCurrent(
    expectedRoute: CodingSiteReturnRoute,
    updates: Partial<CodingSiteReturnRoute>
) {
    const routes = await loadReturnRoutes();
    const routeKey = getReturnRouteKey(expectedRoute.windowId, expectedRoute.llmTabId);
    const currentRoute = routes[routeKey];

    if (!currentRoute || currentRoute.routeRevision !== expectedRoute.routeRevision) {
        return null;
    }

    const savedRoute = {
        ...currentRoute,
        ...updates,
        routeRevision: ++returnRouteRevision
    };
    routes[routeKey] = savedRoute;
    await persistReturnRoutes(routes);
    return savedRoute;
}

async function persistReturnRoutes(routes: Record<string, CodingSiteReturnRoute>) {
    returnRoutes = routes;
    const value = { [RETURN_ROUTES_KEY]: routes };
    await chrome.storage?.local?.set?.(value);
    await chrome.storage?.session?.set?.(value);
}

async function clearReturnRoute(routeKey: string) {
    const routes = await loadReturnRoutes();

    if (!Object.hasOwn(routes, routeKey)) {
        return false;
    }

    delete routes[routeKey];
    await persistReturnRoutes(routes);
    return true;
}

async function clearCopiedPayloadIfCurrent(expectedRoute: CodingSiteReturnRoute) {
    const savedRoute = await saveReturnRouteIfCurrent(expectedRoute, {
        copied: false,
        copiedText: ""
    });
    return Boolean(savedRoute);
}

async function loadReturnRoute() {
    const routes = await loadReturnRoutes();
    const tabs = await chrome.tabs.query({});
    const activeLlmTab = tabs.find(tab => tab.active && isLlmUrl(tab.url));
    return activeLlmTab
        ? routes[getReturnRouteKey(activeLlmTab.windowId, activeLlmTab.id)] || null
        : null;
}

function getReturnRouteKey(windowId: number, llmTabId: number) {
    return `${windowId}:${llmTabId}`;
}

function normalizeReturnRoute(route: unknown): CodingSiteReturnRoute | null {
    if (!route || typeof route !== "object") {
        return null;
    }

    const savedRoute = route as Partial<CodingSiteReturnRoute>;

    if (savedRoute.windowId === undefined || savedRoute.llmTabId === undefined) {
        return null;
    }

    let sourcePlatform = savedRoute.sourcePlatform;

    if (!sourcePlatform && savedRoute.sourceUrl) {
        try {
            sourcePlatform = getPlatform(savedRoute.sourceUrl).name;
        } catch (_) {
            sourcePlatform = "";
        }
    }

    return {
        ...savedRoute,
        windowId: savedRoute.windowId,
        llmTabId: savedRoute.llmTabId,
        sourcePlatform: sourcePlatform || "",
        sourceIdentity: savedRoute.sourceIdentity || getCodingPageIdentity(
            savedRoute.sourceUrl,
            sourcePlatform || ""
        ),
        routeRevision: typeof savedRoute.routeRevision === "number"
            ? savedRoute.routeRevision
            : 0,
        status: savedRoute.status || (savedRoute.sourceTabId ? "routed" : "orphaned")
    };
}

async function loadReturnRoutes() {
    if (returnRoutes) {
        return returnRoutes;
    }

    const stored = await chrome.storage?.local?.get?.([
        RETURN_ROUTES_KEY,
        RETURN_ROUTE_KEY
    ]);
    const sessionStored = await chrome.storage?.session?.get?.([
        RETURN_ROUTES_KEY,
        RETURN_ROUTE_KEY
    ]);
    const savedRoutes = stored?.[RETURN_ROUTES_KEY] ||
        sessionStored?.[RETURN_ROUTES_KEY];

    if (savedRoutes && typeof savedRoutes === "object") {
        returnRoutes = Object.fromEntries(
            Object.entries(savedRoutes)
                .map(([key, route]) => [key, normalizeReturnRoute(route)])
                .filter(([, route]) => route)
        );
        returnRouteRevision = Math.max(
            returnRouteRevision,
            ...Object.values(returnRoutes).map(route => route.routeRevision || 0)
        );
        return returnRoutes;
    }

    const legacyRoute = stored?.[RETURN_ROUTE_KEY] ||
        sessionStored?.[RETURN_ROUTE_KEY];
    const normalizedLegacyRoute = normalizeReturnRoute(legacyRoute);
    returnRoutes = normalizedLegacyRoute?.windowId !== undefined &&
        normalizedLegacyRoute?.llmTabId !== undefined
        ? { [getReturnRouteKey(normalizedLegacyRoute.windowId, normalizedLegacyRoute.llmTabId)]: normalizedLegacyRoute }
        : {};
    returnRouteRevision = Math.max(
        returnRouteRevision,
        ...Object.values(returnRoutes).map(route => route.routeRevision || 0)
    );
    return returnRoutes;
}

function isLlmUrl(url: string | undefined) {
    return LLM_PROVIDERS.some(provider => provider.match(url || ""));
}

async function recordLlmCopy(tabId: number | undefined, text: unknown) {
    if (typeof tabId !== "number" || typeof text !== "string") {
        return;
    }

    const tabs = await chrome.tabs.query({});
    const llmTab = tabs.find(tab => tab.id === tabId && isLlmUrl(tab.url));
    const route = llmTab
        ? (await loadReturnRoutes())[getReturnRouteKey(llmTab.windowId, tabId)]
        : null;

    if (!route || route.llmTabId !== tabId) {
        return;
    }

    await saveReturnRouteIfCurrent(route, {
        copied: true,
        copiedText: text
    });
}

function invalidateReturnRoutesForSourceUrlChange(tabId: number, url: string) {
    if (!Number.isInteger(tabId) || typeof url !== "string") {
        return;
    }

    loadReturnRoutes()
        .then(async routes => {
            const currentTab = await chrome.tabs.get(tabId);
            if (currentTab.url !== url) {
                return;
            }

            let changed = false;

            for (const [key, route] of Object.entries(routes)) {
                if (route.sourceTabId !== tabId || route.sourceUrl === url) {
                    continue;
                }

                const previousIdentity = route.sourceIdentity ||
                    getCodingPageIdentity(route.sourceUrl, route.sourcePlatform);
                const identityPlatform = route.sourcePlatform === "Exercism overview"
                    ? "Exercism"
                    : route.sourcePlatform;
                const nextIdentity = getCodingPageIdentity(url, identityPlatform);

                if (previousIdentity && previousIdentity === nextIdentity) {
                    continue;
                }

                delete routes[key];
                changed = true;
            }

            if (changed) {
                await persistReturnRoutes(routes);
            }
        })
        .catch(error => {
            console.error("[workflow] return route invalidation ERROR:", error);
        });
}

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url === "string") {
        invalidateReturnRoutesForSourceUrlChange(tabId, changeInfo.url);
    }
});

chrome.webNavigation?.onHistoryStateUpdated?.addListener(details => {
    if (details.frameId === 0) {
        invalidateReturnRoutesForSourceUrlChange(details.tabId, details.url);
    }
});

chrome.webNavigation?.onReferenceFragmentUpdated?.addListener(details => {
    if (details.frameId === 0) {
        invalidateReturnRoutesForSourceUrlChange(details.tabId, details.url);
    }
});

chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
    loadReturnRoutes()
        .then(async routes => {
            let changed = false;

            for (const [key, route] of Object.entries(routes)) {
                if (route.llmTabId === tabId) {
                    delete routes[key];
                    changed = true;
                    continue;
                }

                if (
                    route.sourceTabId === tabId &&
                    route.windowId === removeInfo.windowId
                ) {
                    routes[key] = {
                        ...route,
                        sourceTabId: null,
                        status: "orphaned",
                        routeRevision: ++returnRouteRevision
                    };
                    changed = true;
                }
            }

            if (changed) {
                returnRoutes = routes;
                const value = { [RETURN_ROUTES_KEY]: routes };
                await chrome.storage?.local?.set?.(value);
                await chrome.storage?.session?.set?.(value);
            }
        })
        .catch(error => {
            console.error("[workflow] return route cleanup ERROR:", error);
        });
});