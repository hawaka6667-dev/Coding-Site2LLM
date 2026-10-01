declare function importScripts(...urls: string[]): void;

interface Element {
    innerText?: string;
    offsetWidth: number;
    offsetHeight: number;
    disabled?: boolean;
    value?: string;
    isContentEditable?: boolean;
    focus(): void;
    click(): void;
    content?: string;
    CodeMirror?: {
        setValue(value: string): void;
        getValue(): string;
        focus(): void;
    };
}

interface Window {
    monaco?: {
        editor?: {
            getModels(): Array<{ getValue(): string; setValue(value: string): void }>;
            getEditors(): MonacoEditorLike[];
        };
    };
}

interface MonacoEditorLike {
    getModel(): { getValue(): string; setValue(value: string): void } | null;
    focus(): void;
    getDomNode?(): Element | null;
    hasTextFocus?(): boolean;
}

interface CodingSiteContext {
    platform: string;
    title?: string;
    description?: string;
    source?: string;
    language?: string;
    feedback?: string;
}

interface CodingSiteAdapter {
    name: string;
    match(url: string): boolean;
    getContext?(tabId: number): Promise<CodingSiteContext>;
    replaceCode?(tabId: number, text: string): Promise<void>;
    testAndSubmit?(tabId: number, options?: { skipRun?: boolean }): Promise<boolean | void>;
    markComplete?(tabId: number): Promise<boolean>;
}

interface CodingSiteReturnRoute {
    windowId: number;
    llmTabId: number;
    sourceTabId?: number;
    sourceUrl?: string;
    sourcePlatform?: string;
    sourceIdentity?: string;
    routeRevision?: number;
    status?: string;
    copied?: boolean;
    copiedText?: string;
    [key: string]: unknown;
}