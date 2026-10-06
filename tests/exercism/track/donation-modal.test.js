/* @machine
file: tests/exercism/track/donation-modal.test.js
role: verify Exercism track donation dialog dismissal
run: node --test tests/exercism/track/donation-modal.test.js
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");

test("dismisses only the enabled Continue without donating button in a visible dialog", () => {
    const mutationCallbacks = [];

    class Element {
        constructor(tagName, innerText = "", options = {}) {
            this.tagName = tagName;
            this.innerText = innerText;
            this.disabled = options.disabled || false;
            this.attributes = options.attributes || {};
            this.visible = options.visible !== false;
            this.children = [];
            this.parentElement = null;
            this.clickCount = 0;
        }

        append(child) {
            child.parentElement = this;
            this.children.push(child);
            mutationCallbacks.forEach(callback => callback());
            return child;
        }

        remove() {
            if (!this.parentElement) {
                return;
            }

            this.parentElement.children = this.parentElement.children.filter(
                child => child !== this
            );
            this.parentElement = null;
            mutationCallbacks.forEach(callback => callback());
        }

        getBoundingClientRect() {
            return this.visible ? { width: 100, height: 30 } : { width: 0, height: 0 };
        }

        getAttribute(name) {
            return this.attributes[name] || null;
        }

        click() {
            this.clickCount += 1;
            let dialog = this.parentElement;

            while (dialog && dialog.getAttribute("role") !== "dialog") {
                dialog = dialog.parentElement;
            }

            dialog?.remove();
        }

        querySelectorAll(selector) {
            const matches = [];
            const selectors = selector.split(", ");
            const visit = node => {
                for (const child of node.children) {
                    if (
                        selectors.includes(child.tagName) ||
                        (selectors.includes("[role='button']") &&
                            child.getAttribute("role") === "button") ||
                        (selectors.includes("[role='dialog']") &&
                            child.getAttribute("role") === "dialog")
                    ) {
                        matches.push(child);
                    }
                    visit(child);
                }
            };
            visit(this);
            return matches;
        }
    }

    const documentElement = new Element("html");
    const body = documentElement.append(new Element("body"));
    const context = vm.createContext({
        document: {
            documentElement,
            addEventListener: () => {},
            querySelectorAll: selector => documentElement.querySelectorAll(selector)
        },
        MutationObserver: class {
            constructor(callback) {
                mutationCallbacks.push(callback);
            }

            observe() {}
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(
                PROJECT_ROOT,
                "src",
                "worker",
                "exercism",
                "dismiss_dialogs.js"
            ),
            "utf8"
        ),
        context
    );

    const makeDialog = (buttonLabel, options = {}) => {
        const dialog = body.append(new Element("div", "", {
            attributes: { role: "dialog" },
            visible: options.dialogVisible !== false
        }));
        const button = dialog.append(new Element("button", buttonLabel, options));
        return { dialog, button };
    };

    const donationContinue = makeDialog("Continue without donating");
    const noThanks = makeDialog("No, thanks!");
    const nonDismissiveAction = makeDialog("Donate now");
    const disabledDonationContinue = makeDialog("Continue without donating", { disabled: true });
    const hiddenDonationContinue = makeDialog("Continue without donating", { visible: false });
    const ariaDisabledDonationContinue = makeDialog("Continue without donating", {
        attributes: { "aria-disabled": "true" }
    });
    const hiddenDialogContinue = makeDialog("Continue without donating", {
        dialogVisible: false
    });

    assert.equal(donationContinue.button.clickCount, 1);
    assert.equal(noThanks.button.clickCount, 1);
    assert.equal(nonDismissiveAction.button.clickCount, 0);
    assert.equal(disabledDonationContinue.button.clickCount, 0);
    assert.equal(hiddenDonationContinue.button.clickCount, 0);
    assert.equal(ariaDisabledDonationContinue.button.clickCount, 0);
    assert.equal(hiddenDialogContinue.button.clickCount, 0);
    assert.equal(donationContinue.dialog.parentElement, null);
    assert.equal(noThanks.dialog.parentElement, null);
});