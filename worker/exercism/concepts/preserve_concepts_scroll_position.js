/* @machine
file: worker/exercism/concepts/preserve_concepts_scroll_position.js
role: preserve the Exercism concepts page scroll position across reloads
scope: Exercism track concepts pages only
*/

const EXERCISM_CONCEPTS_PATH_PATTERN = /^\/tracks\/[^/]+\/concepts\/?$/;

if (EXERCISM_CONCEPTS_PATH_PATTERN.test(location.pathname)) {
    const RESTORE_WINDOW_MS = 10000;
    let restoring = false;
    let restorePosition = null;
    let restoreTimeoutId = null;
    let restoreFramePending = false;

    function saveScrollPosition() {
        if (restoring || !EXERCISM_CONCEPTS_PATH_PATTERN.test(location.pathname)) {
            return;
        }

        try {
            const scrollStorageKey =
                `codingSite2LlmExercismConceptsScroll:${location.pathname}`;
            sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
        } catch (_) {}
    }

    function restoreScrollPosition() {
        if (!EXERCISM_CONCEPTS_PATH_PATTERN.test(location.pathname)) {
            stopRestoring();
            return;
        }

        let savedPosition;

        try {
            const scrollStorageKey =
                `codingSite2LlmExercismConceptsScroll:${location.pathname}`;
            const storedPosition = sessionStorage.getItem(scrollStorageKey);
            if (storedPosition === null) {
                return;
            }
            savedPosition = Number(storedPosition);
        } catch (_) {
            return;
        }

        if (!Number.isFinite(savedPosition)) {
            return;
        }

        restoring = true;
        restorePosition = savedPosition;
        clearTimeout(restoreTimeoutId);
        restoreTimeoutId = setTimeout(stopRestoring, RESTORE_WINDOW_MS);
        scheduleScrollRestore();
    }

    function stopRestoring() {
        restoring = false;
        restorePosition = null;
        clearTimeout(restoreTimeoutId);
        restoreTimeoutId = null;
    }

    function scheduleScrollRestore() {
        if (!EXERCISM_CONCEPTS_PATH_PATTERN.test(location.pathname)) {
            stopRestoring();
            return;
        }

        if (!restoring || restoreFramePending) {
            return;
        }

        restoreFramePending = true;
        requestAnimationFrame(() => {
            restoreFramePending = false;
            if (restoring && EXERCISM_CONCEPTS_PATH_PATTERN.test(location.pathname)) {
                window.scrollTo(0, restorePosition);
            } else if (restoring) {
                stopRestoring();
            }
        });
    }

    const layoutObserver = new MutationObserver(scheduleScrollRestore);
    layoutObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
    if (typeof ResizeObserver === "function") {
        const resizeObserver = new ResizeObserver(scheduleScrollRestore);
        resizeObserver.observe(document.documentElement);
        if (document.body) {
            resizeObserver.observe(document.body);
        }
    }

    for (const eventName of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        window.addEventListener(eventName, stopRestoring, { passive: true });
    }
    document.addEventListener("turbo:before-visit", stopRestoring);
    window.addEventListener("scroll", saveScrollPosition, { passive: true });
    window.addEventListener("pagehide", saveScrollPosition);
    window.addEventListener("pageshow", restoreScrollPosition);
    document.addEventListener("turbo:load", restoreScrollPosition);
    document.addEventListener("turbo:render", restoreScrollPosition);
    restoreScrollPosition();
}