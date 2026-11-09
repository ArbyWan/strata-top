# strata-top

Live telemetry for a running Strata server (arby-strata C++ front end), read
from its `GET /status` JSON endpoint. Two surfaces, one codebase:

1. **The Go TUI** — `strata-top.exe` / `strata-top.bat` (bubbletea). The full
   live terminal surface: current task, recent-request history, engine counters,
   system commit/RAM. `-once` prints a single headless frame.
2. **The Hermes plugin** — the same data as an ambient/agent-facing layer:
   desktop pane + status-bar chip + palette commands + settings page, plus the
   Python half (`strata_top_status` tool, `/strata-top` slash command, bundled
   skill). The plugin **polls only** — it never mutates the server.

## Layout

```
plugin.yaml            manifest v2 (name/title/version/license/homepage) + config_schema
__init__.py            Python-half register(ctx): tool + slash command + skills
poller.py              stdlib urllib GET /status — the ONLY network door
schemas.py             agent tool schema (sections: server/task/recent/system/engine)
tools.py               handlers (return JSON strings, never raise) + slash frame
dashboard/manifest.json  backend half -> plugin_api.py (FastAPI router, gateway process)
dashboard/plugin_api.py  GET /status (cached poll + health), GET /settings
desktop/plugin.js      desktop half — precompiled JSX, pane + chip + palette + settings peek
skills/strata-top/     bundled SKILL.md
main.go / go.mod       the original TUI (unchanged; stdlib + bubbletea/lipgloss only)
```

## Settings (Settings → Plugins → strata-top)

| key | default | meaning |
| --- | --- | --- |
| `endpoint` | `http://127.0.0.1:8080` | Strata server base URL (no trailing slash needed) |
| `poll_interval_seconds` | `5` | pane poll interval (min 2) |
| `commit_warn_percent` | `90` | chip goes amber at this Windows commit usage |
| `show_chip` | `true` | status-bar chip visibility |

## Activation on this machine

Registration happens at Hermes startup, so every step below needs the gate the
spec set for it:

1. Development link (hot-reload): junction the checkout into the profile —
   `mklink /J "%LOCALAPPDATA%\hermes\profiles\friday\plugins\strata-top" "C:\Hermes\Default Project\strata-top"`
   (Python half door) — and the same under `...\desktop-plugins\` for the
   desktop half. Copy is the fallback; a junction is what makes saves hot-reload.
2. `hermes plugins doctor` — manifest, layout, size (<64 MB), imports.
3. Enable with the Boss's go-ahead: `hermes plugins enable strata-top`, then
   restart Hermes (this session included). The desktop half toggles live under
   Capabilities → Plugins once a window is connected.
4. The plugin is opt-in everywhere: nothing appears until enabled.

## Pitfalls

- Windows charges commit for reserved-but-untouched memory — the commit
  ceiling is what kills a big-ctx run silently. Check commit headroom before
  blaming context depth for a slow run.
- `plugins.enabled` is the Python half's gate; the desktop half has its own
  live toggle. Both start opt-in.
- After any enable/disable, Hermes must restart for the Python half
  (tool/command/skill). The desktop half hot-reloads via the junction.
- LICENSE and README.md are required by the manifest spec's layout; the
  LICENSE file still needs to be added to this repo.
