"""strata-top backend routes — mounted under /api/plugins/strata-top/.

GET  /status    one fresh poll of the configured Strata server, plus computed health
GET  /settings  resolved plugin settings (defaults merged with saved values)
Runs inside the gateway process (FastAPI/Pydantic available there).
"""
import importlib.util
import time

from fastapi import APIRouter

router = APIRouter()


def _load_poller():
    # Load poller.py by file location — the package name has a hyphen, so this
    # is the robust route regardless of how the dashboard mount imports us.
    path = __import__("pathlib").Path(__file__).resolve().parent.parent / "poller.py"
    spec = importlib.util.spec_from_file_location("strata_top_poller", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load poller from {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


poller = _load_poller()

PLUGIN_ID = "strata-top"

# Defaults must match plugin.yaml's config_schema (the settings form writes config.yaml).
DEFAULTS = {
    "endpoint": "http://127.0.0.1:8080",
    "poll_interval_seconds": 5,
    "commit_warn_percent": 90,
    "show_chip": True,
}

_cache = {"url": None, "fetched_at": 0.0, "data": None, "error": None}
_CACHE_TTL = 1.5  # seconds — pane and chip share one poll per tick


def _settings():
    out = dict(DEFAULTS)
    try:
        from hermes_cli.config_effective import load_user_config_effective

        cfg = load_user_config_effective() or {}
        saved = (((cfg.get("plugins") or {}).get("entries") or {}).get(PLUGIN_ID) or {}).get("settings") or {}
        if isinstance(saved, dict):
            out.update(saved)
    except Exception:
        pass  # resolver unavailable → defaults
    return out


def _health(st, error, settings):
    if error:
        return "down", ["no contact: " + error]
    alerts = []
    if not (st.get("server") or {}).get("engine_alive", False):
        alerts.append("engine down")
    warn = float(settings["commit_warn_percent"])
    pct = float((st.get("system") or {}).get("commit_pct", 0) or 0)
    if pct >= warn:
        alerts.append(f"commit usage {pct:.1f}% >= warning threshold {warn:.0f}%")
    return ("warn" if alerts else "ok"), alerts


@router.get("/status")
async def status():
    settings = _settings()
    endpoint = str(settings["endpoint"])
    now = time.time()
    if _cache["url"] == endpoint and (now - _cache["fetched_at"]) < _CACHE_TTL:
        data, error, fetched = _cache["data"], _cache["error"], _cache["fetched_at"]
    else:
        data, error = poller.fetch_status(endpoint)
        fetched = time.time()
        _cache.update({"url": endpoint, "fetched_at": time.time(), "data": data, "error": error})
    state, alerts = _health(data or {}, error, settings)
    return {
        "endpoint": endpoint,
        "fetched_at": fetched,
        "state": state,
        "alerts": alerts,
        "status": data,
        "error": error,
    }


@router.get("/settings")
async def settings():
    s = _settings()
    s["poll_interval_seconds"] = max(2, int(s["poll_interval_seconds"]))
    return s
