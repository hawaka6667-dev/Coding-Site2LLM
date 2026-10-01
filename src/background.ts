/* @machine
file: background.js
role: service-worker entry; load modules and register runtime
contract: preserve import order; later files consume earlier globals
*/
importScripts(
    "worker/diagnostics.js",
    "worker/manage_icon_theme.js",
    "worker/configure_supported_coding_sites_and_llm_providers.js",
    "worker/inject_scripts_and_control_coding_page.js",
    "worker/adapters/exercism_edit_adapter.js",
    "worker/adapters/leetcode_adapter.js",
    "worker/adapters/codewars_adapter.js",
    "worker/adapters/source_fallback_adapter.js",
    "worker/adapters/exercism_overview_adapter.js",
    "worker/route_coding_page_and_build_llm_prompt.js",
    "worker/find_llm_tab_and_insert_prompt.js",
    "worker/state/return_route_store.js",
    "worker/workflows/smart_return_workflow.js",
    "worker/workflows/exercism_workflow.js",
    "worker/workflows/run_coding_context_to_llm_workflow.js"
);
