/* @machine
file: tests/exercism/edit/continue-dialogs.test.js
role: verify Exercism Continue dialog transitions
run: npm run test:unit
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT_DIR } = require("../../worker-test-harness.js");

test("transitions Exercism edit page from Continue dialogs to no dialog state", () => {
    const mutationCallbacks = [];
        let observerOptions;

    class Element {
        constructor(tagName, innerText = "", options = {}) {
            this.tagName = tagName;
            this.innerText = innerText;
            this.disabled = options.disabled || false;
            this.attributes = options.attributes || {};
            this.children = [];
            this.parentElement = null;
            this.clickCount = 0;
        }

        append(child) {
            child.parentElement = this;
            this.children.push(child);
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
            return { width: 100, height: 30 };
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

    const body = new Element("body");
    const documentElement = new Element("html");
    documentElement.append(body);
    const context = vm.createContext({
        document: {
            body,
            documentElement,
            addEventListener: () => {},
            querySelectorAll: selector => body.querySelectorAll(selector)
        },
        MutationObserver: class {
            constructor(callback) {
                mutationCallbacks.push(callback);
            }
                observe(_target, options) {
                    observerOptions = options;
                }
        }
    });

    vm.runInContext(
        fs.readFileSync(
            path.join(ROOT_DIR, "worker", "exercism", "edit", "continue_after_exercism_modals.js"),
            "utf8"
        ),
        context
    );

    const addDialog = (title, buttonLabel = "Continue", buttonOptions = {}) => {
        const dialog = body.append(new Element("section", "", {
            attributes: { role: "dialog" }
        }));
        dialog.append(new Element("h2", title));
        return {
            dialog,
            button: dialog.append(new Element("button", buttonLabel, buttonOptions))
        };
    };
    const tutorial = addDialog("Dig Deeper into Reverse String!");
    const feedback = addDialog("No Immediate Feedback");
    const delayedFeedback = addDialog(
        "Automated feedback is still being generated",
        "Continue without waiting",
        { disabled: true }
    );
    const requestReview = feedback.dialog.append(
        new Element("button", "Request code review")
    );
    const disabledContinue = body.append(
        new Element("button", "Continue", { disabled: true })
    );
    const donationContinue = body.append(new Element("button", "Continue"));

    assert.equal(observerOptions.attributes, true);
    assert.deepEqual(Array.from(observerOptions.attributeFilter), ["disabled", "aria-disabled"]);
    assert.equal(body.querySelectorAll("[role='dialog']").length, 3);
    mutationCallbacks[0]();

    assert.equal(body.querySelectorAll("[role='dialog']").length, 1);
    assert.equal(tutorial.button.clickCount, 1);
    assert.equal(feedback.button.clickCount, 1);
    assert.equal(delayedFeedback.button.clickCount, 0);
    delayedFeedback.button.disabled = false;
    mutationCallbacks[0]();

    assert.equal(body.querySelectorAll("[role='dialog']").length, 0);
    assert.equal(delayedFeedback.button.clickCount, 1);
    assert.equal(requestReview.clickCount, 0);
    assert.equal(disabledContinue.clickCount, 0);
    assert.equal(donationContinue.clickCount, 0);
});
