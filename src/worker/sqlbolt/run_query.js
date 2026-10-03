/* @machine
file: worker/sqlbolt/run_query.js
role: run the focused SQLBolt query with Ctrl+Enter
owns: SQLBolt query-editor keyboard capture
contract: Ctrl+Enter in an SQL editor activates its paired Run Query link
*/

document.addEventListener("keydown", event => {
    if (
        event.key !== "Enter" ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
    ) {
        return;
    }

    const editor = event.target?.closest?.(".sqlinput");
    const runQuery = editor
        ?.closest(".sqlinput_container")
        ?.querySelector("a.submit");

    if (!runQuery || runQuery.textContent.trim().toUpperCase() !== "RUN QUERY") {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    runQuery.click();
}, true);
