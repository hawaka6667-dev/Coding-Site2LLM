/* @machine
file: worker/exercism/preserve_concepts_scroll_position.js
role: preserve the Exercism concepts page scroll position across reloads
scope: Exercism track concepts pages only
*/

const EXERCISM_CONCEPTS_PATH_PATTERN = /^\/tracks\/[^/]+\/concepts\/?$/;

if (EXERCISM_CONCEPTS_PATH_PATTERN.test(location.pathname)) {
    const scrollStorageKey =
        `codingSite2LlmExercismConceptsScroll:${location.pathname}`;
    let restoring = false;

    function saveScrollPosition() {
        if (restoring) {
            return;
        }

        try {
            sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
        } catch (_) {}
    }

    function restoreScrollPosition() {
        let savedPosition;

        try {
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
        let attempts = 0;
        const applyPosition = () => {
            window.scrollTo(0, savedPosition);
            attempts += 1;

            if (Math.abs(window.scrollY - savedPosition) < 1 || attempts >= 120) {
                restoring = false;
                if (Math.abs(window.scrollY - savedPosition) < 1) {
                    saveScrollPosition();
                }
                return;
            }

            requestAnimationFrame(applyPosition);
        };

        requestAnimationFrame(applyPosition);
    }

    window.addEventListener("scroll", saveScrollPosition, { passive: true });
    window.addEventListener("pagehide", saveScrollPosition);
    window.addEventListener("pageshow", restoreScrollPosition);
    document.addEventListener("turbo:load", restoreScrollPosition);
    document.addEventListener("turbo:render", restoreScrollPosition);
    restoreScrollPosition();
}