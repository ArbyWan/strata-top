// strata-top — a live dashboard for a running arby-strata server.
//
// A SEPARATE process that polls GET /status over HTTP. It must never live inside the server: an
// alt-screen renderer sharing the server's process shares its fate, and the server would stop being
// headless. Here the worst case is that this window dies and you press r.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ---------- the wire format (GET /status) ----------

type Record struct {
	Valid      bool    `json:"valid"`
	Clock      string  `json:"clock"`
	PromptN    int64   `json:"prompt_n"`
	GenN       int64   `json:"gen_n"`
	PrefillTps float64 `json:"prefill_tps"`
	DecodeTps  float64 `json:"decode_tps"`
	DraftPct   int     `json:"draft_pct"`
	Finish     string  `json:"finish"`
}

type Status struct {
	Server struct {
		Service     string  `json:"service"`
		Model       string  `json:"model"`
		MaxContext  int64   `json:"max_context"`
		Busy        bool    `json:"busy"`
		EngineAlive bool    `json:"engine_alive"`
		UptimeS     float64 `json:"uptime_s"`
		Sampled     string  `json:"sampled"`
	} `json:"server"`
	Task struct {
		Phase       string  `json:"phase"`
		Waiting     int     `json:"waiting"`
		PromptToken int64   `json:"prompt_tokens"`
		Cached      int64   `json:"cached"`
		PpDone      int64   `json:"pp_done"`
		PpTotal     int64   `json:"pp_total"`
		PrefillTps  float64 `json:"prefill_tps"`
		GenTokens   int64   `json:"gen_tokens"`
		MaxTokens   int64   `json:"max_tokens"`
		DecodeTps   float64 `json:"decode_tps"`
		DraftPct    int     `json:"draft_pct"`
		Last        Record  `json:"last"`
	} `json:"task"`
	System struct {
		Valid            bool    `json:"valid"`
		CommitTotalMiB   float64 `json:"commit_total_mib"`
		CommitLimitMiB   float64 `json:"commit_limit_mib"`
		CommitPct        float64 `json:"commit_pct"`
		CommitHeadroomMB float64 `json:"commit_headroom_mib"`
		RamTotalMiB      float64 `json:"ram_total_mib"`
		RamAvailMiB      float64 `json:"ram_avail_mib"`
	} `json:"system"`
	Launch struct {
		Spec        string `json:"spec"`
		Prefill     string `json:"prefill"`
		Kv          string `json:"kv"`
		KvResident  string `json:"kv_resident"`
		ExpertCache string `json:"expert_cache"`
		VramReserve string `json:"vram_reserve_mib"`
		SpecMinP    string `json:"spec_min_p"`
	} `json:"launch"`
	Engine struct {
		ExpertHitPct  float64 `json:"expert_hit_pct"`
		PciePct       float64 `json:"pcie_pct"`
		KvVramHitPct  float64 `json:"kv_vram_hit_pct"`
		KvFromRamMiB  float64 `json:"kv_from_ram_mib"`
		TailSkipMissd int64   `json:"tail_skip_missed"`
	} `json:"engine"`
	Recent []Record `json:"recent"`
}

// ---------- fetching ----------

var httpClient = &http.Client{Timeout: 2 * time.Second}

func fetch(url string) (Status, error) {
	var st Status
	resp, err := httpClient.Get(url)
	if err != nil {
		return st, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return st, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return st, err
	}
	return st, nil
}

// ---------- model ----------

type tickMsg time.Time

type statusMsg struct {
	st  Status
	err error
}

type model struct {
	url       string
	st        Status
	err       error
	haveData  bool
	lastOK    time.Time
	width     int
	polls     int
	failures  int
}

func tick() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func fetchCmd(url string) tea.Cmd {
	return func() tea.Msg {
		st, err := fetch(url)
		return statusMsg{st: st, err: err}
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(fetchCmd(m.url), tick())
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.KeyMsg:
		switch v.String() {
		case "q", "ctrl+c", "esc":
			return m, tea.Quit
		case "r":
			return m, fetchCmd(m.url)
		}
	case tea.WindowSizeMsg:
		m.width = v.Width
	case tickMsg:
		return m, tea.Batch(fetchCmd(m.url), tick())
	case statusMsg:
		m.polls++
		if v.err != nil {
			m.err = v.err
			m.failures++
		} else {
			m.st = v.st
			m.err = nil
			m.haveData = true
			m.lastOK = time.Now()
		}
	}
	return m, nil
}

// ---------- rendering ----------

func fmtTok(n int64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1e6)
	case n >= 10_000:
		return fmt.Sprintf("%.1fK", float64(n)/1e3)
	case n >= 1_000:
		return fmt.Sprintf("%.1fK", float64(n)/1e3)
	default:
		return fmt.Sprintf("%d", n)
	}
}

func bar(v, peak float64, cells int) string {
	f := v / peak
	if f < 0 {
		f = 0
	}
	if f > 1 {
		f = 1
	}
	filled := int(float64(cells)*f + 0.5)
	return strings.Repeat("#", filled) + strings.Repeat(".", cells-filled)
}

func dash(f float64, suffix string, ok bool) string {
	if !ok || f < 0 {
		return "-"
	}
	return fmt.Sprintf("%.1f%s", f, suffix)
}

// panel draws a titled ASCII box; every content line is padded so the frame stays square.
func panel(title string, rows []string, inner int) []string {
	if inner < len(title)+6 {
		inner = len(title) + 6
	}
	out := []string{fmt.Sprintf("+-- %s %s+", title, strings.Repeat("-", inner-len(title)-5))}
	for _, r := range rows {
		if len(r) > inner-2 {
			r = r[:inner-2]
		}
		out = append(out, "| "+r+strings.Repeat(" ", inner-2-len(r))+" |")
	}
	out = append(out, "+"+strings.Repeat("-", inner-2)+"+")
	return out
}

func (m model) View() string {
	inner := m.width - 2
	if inner < 60 {
		inner = 60
	}
	if inner > 96 {
		inner = 96
	}
	var b []string

	if !m.haveData && m.err != nil {
		b = append(b, "")
		b = append(b, fmt.Sprintf(" strata-top  ->  %s", m.url))
		b = append(b, "")
		b = append(b, panel("NO CONTACT", []string{
			"the server is not answering: " + m.err.Error(),
			"",
			"waiting for it to come back (the view recovers on its own)",
			"r  retry now      q  quit",
		}, inner)...)
		return strings.Join(b, "\n") + "\n"
	}

	st := m.st
	name := st.Server.Model
	if i := strings.LastIndexAny(name, `\/`); i >= 0 {
		name = name[i+1:]
	}
	if len(name) > 42 {
		name = name[:39] + "..."
	}
	up := time.Duration(st.Server.UptimeS * float64(time.Second)).Round(time.Second)
	// the launch config the server reports from its own argv: no label can lie about it
	launch := ""
	if st.Launch.Spec != "" {
		launch = fmt.Sprintf("   spec %s", st.Launch.Spec)
	}
	if st.Launch.Prefill != "" {
		launch += fmt.Sprintf("   prefill %s", st.Launch.Prefill)
	}
	head := fmt.Sprintf(" arby-strata  %s   %s   ctx %s   up %s%s",
		shortURL(m.url), name, fmtTok(st.Server.MaxContext), up.Round(time.Second), launch)
	b = append(b, head, "")

	// ---- current task
	phase := st.Task.Phase
	if phase == "" {
		phase = "-"
	}
	taskRows := []string{
		fmt.Sprintf("phase %-18s waiting %-3d %s", phase, st.Task.Waiting, statusWord(st)),
		fmt.Sprintf("ctx   %-10s cache %-10s", fmtTok(st.Task.PromptToken), fmtTok(st.Task.Cached)),
		fmt.Sprintf("prefill %s", rateOrDash(st.Task.PrefillTps, "tok/s")),
		fmt.Sprintf("decode  %s", rateOrDash(st.Task.DecodeTps, "tok/s")),
	}
	if st.Task.DraftPct >= 0 {
		taskRows = append(taskRows, fmt.Sprintf("drafts %d%% accepted", st.Task.DraftPct))
	}
	if st.Task.MaxTokens > 0 {
		taskRows = append(taskRows, fmt.Sprintf("generated %s / %s  [%s]",
			fmtTok(st.Task.GenTokens), fmtTok(st.Task.MaxTokens),
			bar(float64(st.Task.GenTokens), float64(st.Task.MaxTokens), 30)))
	}
	b = append(b, panel("CURRENT TASK", taskRows, inner)...)

	// ---- request history with the bars that make a slow drift visible
	var histRows []string
	if len(st.Recent) == 0 {
		histRows = append(histRows, "no completed requests yet")
	} else {
		peak := 0.0
		for _, r := range st.Recent {
			if r.DecodeTps > peak {
				peak = r.DecodeTps
			}
		}
		if peak < 26 {
			peak = 26
		}
		n := len(st.Recent)
		if n > 10 {
			n = 10
		}
		for _, r := range st.Recent[:n] {
			histRows = append(histRows, fmt.Sprintf("%s  ctx %-8s %-7s %5.1f t/s  [%s] %s",
				r.Clock, fmtTok(r.PromptN), fmtTok(r.GenN)+" tok", r.DecodeTps,
				bar(r.DecodeTps, peak, 20), r.Finish))
		}
	}
	b = append(b, panel("RECENT REQUESTS", histRows, inner)...)

	// ---- system (sampled by the server at request time, never parsed out of a log)
	sysRows := []string{
		fmt.Sprintf("COMMIT %6.1f / %6.1f GB   %5.1f%%   headroom %6.1f GB %s",
			st.System.CommitTotalMiB/1024, st.System.CommitLimitMiB/1024, st.System.CommitPct,
			st.System.CommitHeadroomMB/1024, warn(st.System.CommitPct > 98)),
		fmt.Sprintf("RAM    %6.1f GB total      free %6.1f GB %s",
			st.System.RamTotalMiB/1024, st.System.RamAvailMiB/1024, warn(st.System.RamAvailMiB/1024 < 4)),
	}
	b = append(b, panel("SYSTEM", sysRows, inner)...)

	engRows := []string{
		fmt.Sprintf("expert cache hit %s   over PCIe %s",
			dash(st.Engine.ExpertHitPct, "%", st.Engine.ExpertHitPct >= 0),
			dash(st.Engine.PciePct, "%", st.Engine.PciePct >= 0)),
		fmt.Sprintf("KV in VRAM     %s   from RAM %s",
			dash(st.Engine.KvVramHitPct, "%", st.Engine.KvVramHitPct >= 0),
			func() string {
				if st.Engine.KvFromRamMiB < 0 {
					return "-"
				}
				return fmt.Sprintf("%.0f MiB", st.Engine.KvFromRamMiB)
			}()),
	}
	b = append(b, panel("ENGINE", engRows, inner)...)

	foot := " q quit   r refresh   polling /status every 0.5s"
	if m.err != nil {
		foot = " reconnecting: " + m.err.Error()
	}
	b = append(b, foot)

	return strings.Join(b, "\n") + "\n"
}

func warn(on bool) string {
	if on {
		return "!!"
	}
	return ""
}

func statusWord(st Status) string {
	if !st.Server.EngineAlive {
		return "ENGINE DOWN"
	}
	if st.Server.Busy {
		return "busy"
	}
	return "idle"
}

func rate(v float64, unit string) string {
	if v <= 0 {
		return "-"
	}
	if v >= 1000 {
		return fmt.Sprintf("%.0f %s", v, unit)
	}
	return fmt.Sprintf("%.1f %s", v, unit)
}

// rateOrDash is the task-panel form: prefill and decode own a line each, so an
// inactive phase reads --/-- rather than a bare dash.
func rateOrDash(v float64, unit string) string {
	if v <= 0 {
		return "--/--"
	}
	return rate(v, unit)
}

func shortURL(u string) string {
	u = strings.TrimPrefix(u, "http://")
	return strings.TrimSuffix(u, "/status")
}

// ---------- main ----------

func main() {
	url := flag.String("url", "http://127.0.0.1:8080/status", "the server's /status URL")
	once := flag.Bool("once", false, "print one frame and exit (no alt-screen; for tests and scripts)")
	flag.Parse()

	// --once must also work as the DEFAULT invocation for a script: honour it via env too.
	if os.Getenv("STRATA_TOP_ONCE") == "1" {
		*once = true
	}

	if *once {
		st, err := fetch(*url)
		if err != nil {
			fmt.Fprintf(os.Stderr, "strata-top: %s: %v\n", *url, err)
			os.Exit(1)
		}
		m := model{url: *url, st: st, haveData: true, width: 90}
		fmt.Print(m.View())
		return
	}

	p := tea.NewProgram(model{url: *url, width: 90}, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "strata-top: %v\n", err)
		os.Exit(1)
	}
}
