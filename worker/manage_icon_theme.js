/* @machine
file: worker/manage_icon_theme.js
role: apply the user's selected toolbar icon skin
*/
const ICON_THEME_PATHS = Object.freeze({
    "ice-cyan": "icons/icon-theme-ice-cyan",
    "warm-ivory": "icons/icon-theme-warm-ivory",
    mint: "icons/icon-theme-mint",
    lemon: "icons/icon-theme-lemon"
});
const DEFAULT_ICON_THEME = "ice-cyan";

if (typeof chrome === "undefined" || !chrome.storage?.local || !chrome.action?.setIcon) {
    // Unit-test sandboxes load the service worker without extension APIs.
} else {

function getIconThemePath(theme) {
    const basePath = ICON_THEME_PATHS[theme] || ICON_THEME_PATHS[DEFAULT_ICON_THEME];
    return {
        16: `${basePath}-16.png`,
        32: `${basePath}-32.png`,
        48: `${basePath}-48.png`,
        128: `${basePath}-128.png`
    };
}

async function applyIconTheme(theme) {
    await chrome.action.setIcon({ path: getIconThemePath(theme) });
}

chrome.storage.local.get({ iconTheme: DEFAULT_ICON_THEME })
    .then(({ iconTheme }) => applyIconTheme(iconTheme))
    .catch(() => applyIconTheme(DEFAULT_ICON_THEME));

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.iconTheme) {
        return;
    }

    applyIconTheme(changes.iconTheme.newValue).catch(() => {
        applyIconTheme(DEFAULT_ICON_THEME);
    });
});
}
