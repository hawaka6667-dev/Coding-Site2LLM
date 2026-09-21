/*
 * Manifest V3 service-worker entry point.
 * Keep the import order: later files use globals defined by earlier files.
 */
importScripts(
    "worker/configure_supported_coding_sites_and_llm_providers.js",
    "worker/inject_scripts_and_control_coding_page.js",
    "worker/extract_coding_site_context_with_site_adapters.js",
    "worker/route_coding_page_and_build_llm_prompt.js",
    "worker/find_llm_tab_and_insert_prompt.js",
    "worker/run_coding_context_to_llm_workflow.js"
);
