/* @machine
file: worker/workflows/smart_return/route_store.js
role: persist Smart Return routes and guard revision-based mutations
contract: route changes derived from snapshots must match the persisted revision
*/

namespace SmartReturn {
    export interface Route {
        windowId: number;
        llmTabId: number;
        sourceTabId?: number | null;
        sourceUrl?: string;
        sourcePlatform?: string;
        sourceIdentity?: string;
        routeRevision?: number;
        status?: string;
        copied?: boolean;
        copiedText?: string;
        [key: string]: unknown;
    }

    const RETURN_ROUTE_KEY = "codingSite2LlmReturnRoute";
    const RETURN_ROUTES_KEY = "codingSite2LlmReturnRoutes";

    export class RouteStore {
        private routes: Record<string, Route> | null = null;
        private loadPromise: Promise<Record<string, Route>> | null = null;
        private mutationQueue: Promise<void> = Promise.resolve();
        private revision = 0;

        save(route: Route) {
            return this.mutate(async () => {
                const routes = await this.loadAll();
                const savedRoute = { ...route, routeRevision: ++this.revision };
                routes[this.getKey(route.windowId, route.llmTabId)] = savedRoute;
                await this.persist(routes);
                return savedRoute;
            });
        }

        async get(windowId: number, llmTabId: number) {
            const routes = await this.loadAll();
            return routes[this.getKey(windowId, llmTabId)] || null;
        }

        updateIfCurrent(
            expectedRoute: Route,
            updates: Partial<Route>
        ) {
            return this.mutate(async () => {
                const routes = await this.loadAll();
                const key = this.getKey(expectedRoute.windowId, expectedRoute.llmTabId);
                const currentRoute = routes[key];

                if (!currentRoute || currentRoute.routeRevision !== expectedRoute.routeRevision) {
                    return null;
                }

                const savedRoute = {
                    ...currentRoute,
                    ...updates,
                    routeRevision: ++this.revision
                };
                routes[key] = savedRoute;
                await this.persist(routes);
                return savedRoute;
            });
        }

        clearIfCurrent(expectedRoute: Route) {
            return this.mutate(async () => {
                const routes = await this.loadAll();
                const key = this.getKey(expectedRoute.windowId, expectedRoute.llmTabId);
                const currentRoute = routes[key];

                if (!currentRoute || currentRoute.routeRevision !== expectedRoute.routeRevision) {
                    return false;
                }

                delete routes[key];
                await this.persist(routes);
                return true;
            });
        }

        async clearCopiedPayloadIfCurrent(expectedRoute: Route) {
            const savedRoute = await this.updateIfCurrent(expectedRoute, {
                copied: false,
                copiedText: ""
            });
            return Boolean(savedRoute);
        }

        invalidateSourceUrlChange(tabId: number, url: string) {
            return this.mutate(async () => {
                const routes = await this.loadAll();
                let changed = false;

                for (const [key, route] of Object.entries(routes)) {
                    if (route.sourceTabId !== tabId || route.sourceUrl === url) {
                        continue;
                    }

                    const previousIdentity = route.sourceIdentity ||
                        getCodingPageIdentity(route.sourceUrl || "", route.sourcePlatform || "");
                    const identityPlatform = route.sourcePlatform === "Exercism overview"
                        ? "Exercism"
                        : route.sourcePlatform || "";
                    const nextIdentity = getCodingPageIdentity(url, identityPlatform);

                    if (previousIdentity && previousIdentity === nextIdentity) {
                        continue;
                    }

                    delete routes[key];
                    changed = true;
                }

                if (changed) {
                    await this.persist(routes);
                }
            });
        }

        removeTab(tabId: number, windowId: number) {
            return this.mutate(async () => {
                const routes = await this.loadAll();
                let changed = false;

                for (const [key, route] of Object.entries(routes)) {
                    if (route.llmTabId === tabId) {
                        delete routes[key];
                        changed = true;
                        continue;
                    }

                    if (route.sourceTabId === tabId && route.windowId === windowId) {
                        routes[key] = {
                            ...route,
                            sourceTabId: null,
                            status: "orphaned",
                            routeRevision: ++this.revision
                        };
                        changed = true;
                    }
                }

                if (changed) {
                    await this.persist(routes);
                }
            });
        }

        private getKey(windowId: number, llmTabId: number) {
            return `${windowId}:${llmTabId}`;
        }

        private normalize(route: unknown): Route | null {
            if (!route || typeof route !== "object") {
                return null;
            }

            const savedRoute = route as Partial<Route>;
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
                    savedRoute.sourceUrl || "",
                    sourcePlatform || ""
                ),
                routeRevision: typeof savedRoute.routeRevision === "number"
                    ? savedRoute.routeRevision
                    : 0,
                status: savedRoute.status || (savedRoute.sourceTabId ? "routed" : "orphaned")
            };
        }

        private loadAll() {
            if (this.routes) {
                return Promise.resolve(this.routes);
            }

            if (!this.loadPromise) {
                this.loadPromise = this.readStoredRoutes().finally(() => {
                    this.loadPromise = null;
                });
            }

            return this.loadPromise;
        }

        private async readStoredRoutes() {
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
                this.routes = Object.fromEntries(
                    Object.entries(savedRoutes)
                        .map(([key, route]) => [key, this.normalize(route)])
                        .filter(([, route]) => route)
                );
                this.revision = Math.max(
                    this.revision,
                    ...Object.values(this.routes).map(route => route.routeRevision || 0)
                );
                return this.routes;
            }

            const legacyRoute = stored?.[RETURN_ROUTE_KEY] ||
                sessionStored?.[RETURN_ROUTE_KEY];
            const normalizedLegacyRoute = this.normalize(legacyRoute);
            this.routes = normalizedLegacyRoute
                ? { [this.getKey(normalizedLegacyRoute.windowId, normalizedLegacyRoute.llmTabId)]: normalizedLegacyRoute }
                : {};
            this.revision = Math.max(
                this.revision,
                ...Object.values(this.routes).map(route => route.routeRevision || 0)
            );
            return this.routes;
        }

        private mutate<T>(operation: () => Promise<T>) {
            const current = this.mutationQueue.then(operation, operation);
            this.mutationQueue = current.then(
                (): void => undefined,
                (): void => undefined
            );
            return current;
        }

        private async persist(routes: Record<string, Route>) {
            this.routes = routes;
            const value = { [RETURN_ROUTES_KEY]: routes };
            await chrome.storage?.local?.set?.(value);
            await chrome.storage?.session?.set?.(value);
        }
    }

    export const routes = new RouteStore();
}