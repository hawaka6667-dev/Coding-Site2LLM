/* @machine
file: worker/inject_scripts_and_control_coding_page.js
role: execute page functions and control page timing
contract: executePage functions are self-contained
*/

function pageUrl(url: string | undefined) {
    return typeof url === "string" && url.startsWith("view-source:")
        ? url.slice("view-source:".length)
        : url;
}

function isViewSourceUrl(url: string | undefined) {
    return typeof url === "string" && url.startsWith("view-source:");
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function keyTap(tabId: number, key: string) {
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

async function scrollUp(tabId: number, amount = 50) {
    await executePage(tabId, scrollAmount => {
        window.scrollBy({ top: -scrollAmount, behavior: "auto" });
    }, [amount]);
}

async function executePage<Result = any>(
    tabId: number,
    func: (...args: any[]) => Result,
    args: any[] = [],
    world: "MAIN" | "ISOLATED" = "MAIN"
): Promise<Awaited<Result> | undefined> {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func,
        args
    });

    return results[0]?.result as Awaited<Result> | undefined;
}

async function executePageAllFrames(
    tabId: number,
    func: (...args: any[]) => any,
    args: any[] = [],
    world: "MAIN" | "ISOLATED" = "MAIN"
): Promise<chrome.scripting.InjectionResult<any>[]> {
    return chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world,
        func,
        args
    });
}