"""Tool handlers — the code that runs when the LLM calls each tool, plus the /strata-top frame.

Rules obeyed: handlers return JSON strings, never raise; the poller is stdlib-only.
"""
import json

from . import schemas  # noqa: F401  (manifest/tool registry parity)

try:  # package-relative import when loaded as a Hermes plugin package
    from . import poller
except ImportError:  # standalone import used by dashboard/plugin_api.py
    import poller

# Injected by register() in __init__.py: resolver(key, default) -> settings value.
_settings = lambda key, default=None: default  # noqa: E731


def init(settings_resolver):
    global _settings
    _settings = settings_resolver


def _health(st, error):
    if error:
        return "down", [f"no contact: {error}"]
    alerts = []
    server = st.get("server") or {}
    system = st.get("system") or {}
    if not server.get("engine_alive", False):
        alerts.append("engine down")
    warn = int(_settings("commit_warn_percent", 90) or 90)
    pct = float(system.get("commit_pct", 0) or 0)
    if pct >= warn:
        alerts.append(f"commit usage {pct:.1f}% >= warning threshold {warn}%")
    return ("warn" if alerts else "ok"), alerts


def strata_top_status(args: dict, **kwargs) -> str:
    args = args or {}
    include = str(args.get("include") or "all").strip().lower()
    endpoint = _settings("endpoint", "http://127.0.0.1:8080")
    st, error = poller.fetch_status(endpoint)
    state, alerts = _health(st, error)
    out = {
        "endpoint": endpoint,
        "state": state,
        "alerts": alerts,
    }
    if st is not None:
        if include == "all":
            out["status"] = st
        elif include in ("server", "task", "recent", "system", "engine"):
            out["status"] = {include: st.get(include)}
        else:
            out["error"] = f"unknown include section: {include}"
    else:
        out["error"] = f"could not reach {endpoint}/status: {error}"
    return json.dumps(out)


# ---------- /strata-top slash command (one text frame, --once in spirit) ----------

def _fmt_tok(n):
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n/1e6:.1f}M"
    if n >= 1_000:
        return f"{n/1e3:.1f}K"
    return str(n)


def _rate(v, unit="tok/s"):
    v = float(v or 0)
    if v <= 0:
        return "-"
    if v >= 1000:
        return f"{v:.0f} {unit}"
    return f"{v:.1f} {unit}"


def _rate_or_dash(v, unit="tok/s"):
    """A throughput, or --/-- while that phase isn't producing one (idle prefill, no decode yet)."""
    return _rate(v, unit) if float(v or 0) > 0 else "--/--"


def _bar(v, peak, cells=20):
    v, peak = float(v or 0), float(peak or 0)
    f = 0.0 if peak <= 0 else max(0.0, min(1.0, v / peak))
    filled = int(cells * f + 0.5)
    return "#" * filled + "." * (cells - filled)


def _status_word(st):
    server = st.get("server") or {}
    if not server.get("engine_alive", False):
        return "ENGINE DOWN"
    return "busy" if server.get("busy") else "idle"


def _frame(st, error):
    lines = ["strata-top — one frame"]
    if st is None:
        lines += ["", f"NO CONTACT: {error}", "the view recovers on its own"]
        return "\n".join(lines)
    server = st.get("server") or {}
    task = st.get("task") or {}
    system = st.get("system") or {}
    engine = st.get("engine") or {}
    recent = st.get("recent") or []

    name = str(server.get("model") or "-")
    name = name.replace("\\", "/").split("/")[-1]
    lines = [
        f"arby-strata  {name}  ctx {_fmt_tok(server.get('max_context'))}  up {int(float(server.get('uptime_s') or 0))}s  [{_status_word(st)}]",
        "",
        "CURRENT TASK",
        f"  phase {task.get('phase') or '-'}  waiting {task.get('waiting', 0)}",
        f"  prefill {_rate_or_dash(task.get('prefill_tps'))}",
        f"  decode  {_rate_or_dash(task.get('decode_tps'))}",
        f"  ctx {_fmt_tok(task.get('prompt_tokens'))}  cache {_fmt_tok(task.get('cached'))}",
        f"  drafts {('%d%% accepted' % task['draft_pct']) if int(task.get('draft_pct', -1) or -1) >= 0 else '-'}",
    ]
    if int(task.get("max_tokens") or 0) > 0:
        lines.append(f"  generated {_fmt_tok(task.get('gen_tokens'))} / {_fmt_tok(task.get('max_tokens'))} [{_bar(task.get('gen_tokens'), task.get('max_tokens'), 30)}]")
    lines.append("")
    lines.append("RECENT REQUESTS")
    if not recent:
        lines.append("  no completed requests yet")
    else:
        peak = max([float(r.get("decode_tps") or 0) for r in recent] + [26.0])
        for r in recent[:10]:
            lines.append(
                f"  {r.get('clock')}  ctx {_fmt_tok(r.get('prompt_n'))}  {_fmt_tok(r.get('gen_n'))} tok  {float(r.get('decode_tps') or 0):5.1f} t/s  [{_bar(r.get('decode_tps'), peak)}] {r.get('finish')}"
            )
    lines.append("")
    lines.append("SYSTEM")
    commit_pct = float(system.get("commit_pct") or 0)
    warn = int(_settings("commit_warn_percent", 90) or 90)
    lines.append(
        f"  COMMIT {float(system.get('commit_total_mib') or 0)/1024:6.1f} / {float(system.get('commit_limit_mib') or 0)/1024:6.1f} GB  {commit_pct:5.1f}%  headroom {float(system.get('commit_headroom_mib') or 0)/1024:6.1f} GB {'!!' if commit_pct >= warn else ''}"
    )
    lines.append(
        f"  RAM    {float(system.get('ram_total_mib') or 0)/1024:6.1f} GB total  free {float(system.get('ram_avail_mib') or 0)/1024:6.1f} GB {'!!' if float(system.get('ram_avail_mib') or 0)/1024 < 4 else ''}"
    )
    lines.append("")
    lines.append("ENGINE")
    lines.append(
        f"  expert cache hit {engine.get('expert_hit_pct') if engine.get('expert_hit_pct', -1) >= 0 else '-'}%  over PCIe {engine.get('pcie_pct') if engine.get('pcie_pct', -1) >= 0 else '-'}%"
    )
    lines.append(
        f"  KV in VRAM {engine.get('kv_vram_hit_pct') if engine.get('kv_vram_hit_pct', -1) >= 0 else '-'}%  from RAM {int(engine.get('kv_from_ram_mib') or 0) if engine.get('kv_from_ram_mib', -1) >= 0 else '-'} MiB"
    )
    return "\n".join(lines)


def slash_frame(raw_args: str = "") -> str:
    raw = (raw_args or "").strip()
    if raw.lower() in ("help", "-h", "--help"):
        return (
            "Usage: /strata-top — print one live frame from the Strata server's /status.\n"
            "Settings live under plugins.strata-top.* (endpoint, poll interval, commit warning).\n"
            "The terminal TUI (strata-top.exe) remains the full live surface."
        )
    endpoint = _settings("endpoint", "http://127.0.0.1:8080")
    st, error = poller.fetch_status(endpoint)
    return _frame(st, error)


if __name__ == "__main__":  # local smoke test against a live server
    print(slash_frame())
