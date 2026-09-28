/* @machine
file: worker/adapters/exercism_overview_adapter.ts
role: own the exercism overview adapter site adapter
*/

const ExercismOverviewAdapter: CodingSiteAdapter = {

    name: "Exercism overview",

    match(url) {
        return EXERCISM_OVERVIEW_URL.test(url);
    },

    async markComplete(tabId) {
        return completeExercismExercise(tabId);
    }
};

async function completeExercismExercise(tabId: number) {
    let markedComplete = false;
    const markStart = performance.now();

    while (performance.now() - markStart < 5000) {
        try {
            markedComplete = await executePage(tabId, () => {
                const button = [...document.querySelectorAll("button")]
                    .find(candidate =>
                        candidate.offsetWidth > 0 &&
                        candidate.offsetHeight > 0 &&
                        !candidate.disabled &&
                        /mark as complete/i.test(
                            candidate.innerText.trim()
                        )
                    );

                if (!button) {
                    return false;
                }

                button.click();
                return true;
            });
        } catch (_) {
            // Submission may navigate directly to the completed page.
            return false;
        }

        if (markedComplete) break;
        await sleep(100);
    }

    if (!markedComplete) {
        return false;
    }

    const confirmStart = performance.now();
    let confirmClicked = false;
    while (performance.now() - confirmStart < 5000) {
        try {
            const result = await executePage(tabId, hasClickedConfirm => {
                const statusNode = document.querySelector(
                    '[data-react-id="student-open-editor-button"]'
                );
                let status = "";

                try {
                    status = JSON.parse(
                        statusNode?.getAttribute("data-react-data") || "{}"
                    ).status || "";
                } catch (_) {}

                const completionResultVisible = [
                    ...document.querySelectorAll("dialog, [role='dialog']")
                ].some(dialog =>
                    dialog.offsetWidth > 0 &&
                    dialog.offsetHeight > 0 &&
                    /you['’]ve completed\b/i.test(
                        (dialog.innerText || dialog.textContent || "").trim()
                    )
                );

                const button = [...document.querySelectorAll("button")]
                    .find(candidate =>
                        candidate.offsetWidth > 0 &&
                        candidate.offsetHeight > 0 &&
                        !candidate.disabled &&
                        /^(confirm|complete)$/i.test(
                            candidate.innerText.trim()
                        )
                    );

                if (status === "completed" || completionResultVisible) {
                    return "completed";
                }

                if (!button || hasClickedConfirm) {
                    return "waiting";
                }

                button.click();
                return "confirm-clicked";
            }, [confirmClicked]);

            if (result === "completed") return true;
            if (result === "confirm-clicked") confirmClicked = true;
        } catch (_) {
            return false;
        }

        await sleep(100);
    }

    return false;
}
