"""Tool schemas — what the LLM sees."""

STRATA_TOP_STATUS = {
    "name": "strata_top_status",
    "description": (
        "Read live telemetry from the running Strata inference server (arby-strata GET /status): "
        "server/model, current task phase and throughput, recent request history, system commit/RAM, "
        "and engine counters (expert cache hit, PCIe, KV residency). Use before starting a generation "
        "on the rig ('is the engine alive?', 'how much commit headroom is left?'), for watchdog checks, "
        "or to compare prefill/decode rates. The server may be answering even while a model is loading; "
        "no contact means it is down or the endpoint setting is wrong."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "include": {
                "type": "string",
                "enum": ["all", "server", "task", "recent", "system", "engine"],
                "description": "Which section of the status to return (default: all).",
                "default": "all",
            }
        },
        "required": [],
    },
}
