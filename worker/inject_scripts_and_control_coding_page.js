/* @machine
file: worker/inject_scripts_and_control_coding_page.js
role: execute page functions and control page timing
contract: executePage functions are self-contained
*/

function pageUrl(url) {
    return typeof url === "string" && url.startsWith("view-source:")
        ? url.slice("view-source:".length)
        : url;
}

function isViewSourceUrl(url) {
    return typeof url === "string" && url.startsWith("view-source:");
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function keyTap(tabId, key) {
    await executePage(tabId, (pressedKey) => {
        const input = document.activeElement;
        if (!input) {
            return false;
        }

        for (const type of ["keydown", "keyup"]) {
            input.dispatchEvent(new KeyboardEvent(type, {
                key: pressedKey,
                code: pressedKey,
                bubbles: true,
                cancelable: true
            }));
        }

        return true;
    }, [key]);
}

async function scrollUp(tabId, amount = 50) {
    await executePage(tabId, scrollAmount => {
        window.scrollBy({ top: -scrollAmount, behavior: "auto" });
    }, [amount]);
}

async function executePage(tabId, func, args = [], world = "MAIN") {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func,
        args
    });

    return results[0]?.result;
}

async function executePageAllFrames(tabId, func, args = [], world = "MAIN") {
    return chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world,
        func,
        args
    });
}