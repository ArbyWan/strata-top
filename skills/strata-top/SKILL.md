---
name: strata-top
description: Use for live Strata server telemetry via strata-top.
version: 0.1.0
license: MIT
metadata:
  hermes:
    tags: [strata, telemetry, monitoring, dashboard]
---

# Strata-Top — live Strata server telemetry

Read-only view of a running Strata server (arby-strata C++ front end) built on
its `GET /status` JSON endpoint. The plugin polls; it never mutates the server.

## Surfaces

- **Agent tool** `strata_top_status` — sections: `server`, `task`, `recent`,
  `system`, `engine`; `include=all` returns everything. Answers even while a
  model is loading; "no contact" means the server is down or the endpoint
  setting is wrong.
- **Slash command** `/strata-top` — prints one text frame (the Go TUI's
  `--once` in spirit) without opening the full TUI. `help` for usage.
- **Desktop pane + status-bar chip** — the pane polls on the configured
  interval; the chip shows ok/warn/down health and alerts. Both live under
  the desktop app once the plugin is enabled there (Capabilities → Plugins).
- **Settings** — Settings → Plugins → strata-top (form generated from
  `plugin.yaml`'s `config_schema`): endpoint (default
  `http://127.0.0.1:8080`), poll interval (min 2 s), commit warning threshold,
  chip visibility.

## When to use

- "Is the engine alive?" / "how much commit headroom is left?" before starting
  a generation on the rig.
- Comparing prefill/decode rates between runs, or checking recent-request
  history without launching `strata-top.exe`.

## Layout (keep all three surfaces in step)

The CURRENT TASK block renders the same shape in every surface: a `phase` line
(with `waiting`), then `prefill` and `decode` each on their OWN line, and an
inactive phase reads `--/--` (not `-`). Three helpers do that, one per surface:
`rateOrDash()` in `main.go`, `rateOrDash()` in `desktop/plugin.js`,
`_rate_or_dash()` in `tools.py`. Edit one, mirror the other two.

## Rebuilding the TUI (`strata-top.exe`)

Go is NOT on PATH on this box. A portable SDK lives at
`C:\Users\JoshJ\go-sdk\go\bin\go.exe` (go1.27.3 — matches `go.mod`'s `go 1.27.3`).

```
cd "C:/Hermes/Default Project/strata-top"
export PATH="/c/Users/JoshJ/go-sdk/go/bin:$PATH"
go build -o strata-top.exe .
./strata-top.exe -once          # one frame, no alt-screen; verify the panel
```

Then copy the exe into the installed plugin dir
(`~/.hermes/profiles/<profile>/plugins/strata-top/strata-top.exe`) so the plugin
copy matches the checkout. `-once` honours `--url` and `STRATA_TOP_ONCE=1`, so a
throwaway JSON stub on a spare port verifies idle/`--/--` rendering without the
real server.

## Pitfalls

- Windows charges commit for reserved-but-untouched memory: the commit
  ceiling — not RAM — is what kills a run silently. Check commit headroom
  before blaming context depth for a slow run (the plugin warns at the
  configured threshold, default 90%).
- The full live terminal surface remains `strata-top.exe` (bubbletea TUI);
  the plugin is the ambient/agent-facing layer on top, not a replacement.
- Registration happens at Hermes startup — after enabling, a restart is
  needed for the tool/slash command/skill.
