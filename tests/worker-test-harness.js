const fs = require("node:fs");

const path = require("node:path");

const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..", "dist");

function loadCoreWorker() {
    const tabState = [];
    const messageListeners = [];
    const tabUpdatedListeners = [];
    const historyStateUpdatedListeners = [];
    const referenceFragmentUpdatedListeners = [];
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: listener => messageListeners.push(listener) } },
        scripting: { executeScript: async () => [{ result: true }] },
        webNavigation: {
            onHistoryStateUpdated: {
                addListener: listener => historyStateUpdatedListeners.push(listener)
            },
            onReferenceFragmentUpdated: {
                addListener: listener => referenceFragmentUpdatedListeners.push(listener)
            }
        },
        tabs: {
            onUpdated: { addListener: listener => tabUpdatedListeners.push(listener) },
            query: async details => details?.windowId
                ? tabState.filter(tab => tab.windowId === details.windowId)
                : tabState,
            update: async () => {},
            get: async () => ({})
        }
    };
    const context = vm.createContext({
        chrome,
        console,
        URL,
        performance,
        setTimeout,
        clearTimeout
    });

    context.importScripts = (...files) => {
        for (const file of files) {
            const source = fs.readFileSync(path.join(ROOT_DIR, file), "utf8");
            vm.runInContext(source, context, { filename: file });
        }
    };
    context.tabState = tabState;
    context.messageListeners = messageListeners;
    context.tabUpdatedListeners = tabUpdatedListeners;
    context.historyStateUpdatedListeners = historyStateUpdatedListeners;
    context.referenceFragmentUpdatedListeners = referenceFragmentUpdatedListeners;

    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    return context;
}

function loadKeyboardShortcuts(hostname = "example.com", savedShortcuts = {}, selectedText = "") {
    const listeners = [];
    const windowListeners = [];
    const messages = [];
    const context = vm.createContext({
        chrome: {
            storage: { local: { get: async () => ({ codingSite2LlmShortcuts: savedShortcuts }) } },
            runtime: { sendMessage: message => messages.push(message) }
        },
        document: { addEventListener: (type, listener) => listeners.push({ type, listener }) },
        window: {
            getSelection: () => ({ toString: () => selectedText }),
            addEventListener: (type, listener) => windowListeners.push({ type, listener })
        },
        location: { hostname }
    });
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "worker", "keyboard_shortcuts.js"), "utf8"),
        context
    );
    return { context, listeners, messages, windowListeners };
}

function loadRoutingWorker({ tabs = [], autoMarkComplete = true } = {}) {
    const messageListeners = [];
    const createdTabs = [];
    const createdWindows = [];
    const removedTabs = [];
    const chrome = {
        action: { onClicked: { addListener: () => {} } },
        commands: { onCommand: { addListener: () => {} } },
        runtime: { onMessage: { addListener: listener => messageListeners.push(listener) } },
        scripting: { executeScript: async () => [{ result: true }] },
        storage: {
            local: { get: async () => ({ exercismAutoMarkComplete: autoMarkComplete }) }
        },
        tabs: {
            query: async () => tabs,
            get: async tabId => tabs.find(tab => tab.id === tabId),
            create: async properties => {
                createdTabs.push(properties);
                return { id: createdTabs.length + 10, ...properties };
            },
            remove: async tabId => removedTabs.push(tabId),
            update: async () => {}
        },
        windows: {
            create: async properties => {
                createdWindows.push(properties);
                return { id: createdWindows.length + 20, ...properties };
            }
        }
    };
    const context = vm.createContext({ chrome, console, performance, setTimeout, URL });
    context.importScripts = (...files) => {
        for (const file of files) {
            vm.runInContext(
                fs.readFileSync(path.join(ROOT_DIR, file), "utf8"),
                context,
                { filename: file }
            );
        }
    };
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, "background.js"), "utf8"),
        context
    );
    context.messageListeners = messageListeners;
    context.createdTabs = createdTabs;
    context.createdWindows = createdWindows;
    context.removedTabs = removedTabs;
    return context;
}

function loadExercismOverviewScript(documentOverrides = {}, chromeOverrides = {}) {
    const chrome = {
        storage: {
            local: { get: async () => ({}), set: async () => {} },
            onChanged: { addListener: () => {} }
        },
        ...chromeOverrides
    };
    const document = {
        documentElement: null,
        addEventListener: () => {},
        querySelector: () => null,
        ...documentOverrides
    };
    const sessionStorage = {
        entries: new Map(),
        getItem(key) {
            return this.entries.has(key) ? this.entries.get(key) : null;
        },
        setItem(key, value) {
            this.entries.set(key, String(value));
        }
    };
    const context = vm.createContext({
        chrome,
        console,
        document,
        sessionStorage,
        location: { href: "", assign: () => {} }
    });

    for (const file of [
        "worker/exercism/overview/open_exercise_in_editor.js"
    ]) {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT_DIR, file), "utf8"),
            context,
            { filename: file }
        );
    }

    return context;
}

module.exports = { ROOT_DIR, loadCoreWorker, loadKeyboardShortcuts, loadRoutingWorker, loadExercismOverviewScript };
