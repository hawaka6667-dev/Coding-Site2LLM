/* @machine
file: worker/exercism/submitted_overview/close_submitted_overview_after_completion.js
role: request closing the owned overview after confirmed exercise completion
scope: Exercism overview pages only
*/

const SUBMITTED_OVERVIEW_CLOSE_NOTICE_TYPE =
    "exercism-submitted-overview-completion-result";
const SUBMITTED_OVERVIEW_CLOSE_REQUEST_TYPE =
    "exercism-close-submitted-overview-window";
const SUBMITTED_OVERVIEW_CLOSE_PAGE_PATTERN =
    /^https:\/\/exercism\.org\/tracks\/[^/]+\/exercises\/[^/?#]+\/?(?:[?#]|$)/;

function isSubmittedOverviewClosePage(url = location.href) {
    return SUBMITTED_OVERVIEW_CLOSE_PAGE_PATTERN.test(url);
}

function handleSubmittedOverviewCompletionNotice(message) {
    if (
        message?.type !== SUBMITTED_OVERVIEW_CLOSE_NOTICE_TYPE ||
        message.completed !== true ||
        !isSubmittedOverviewClosePage()
    ) {
        return;
    }

    chrome.runtime.sendMessage({
        type: SUBMITTED_OVERVIEW_CLOSE_REQUEST_TYPE
    }).catch(() => {});
}

chrome.runtime.onMessage.addListener(handleSubmittedOverviewCompletionNotice);