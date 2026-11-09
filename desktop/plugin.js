// strata-top desktop half — live pane + status-bar chip + palette commands.
// Precompiled JSX (no build step); imports fenced to @hermes/plugin-sdk + react.
import {
  PALETTE_AREA,
  STATUSBAR_AREAS,
  Badge,
  host,
  pluginSettingsHref,
  useQuery,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useMemo } from 'react'

const PLUGIN_ID = 'strata-top'

const mono = {
  fontFamily:
    "ui-monospace, 'Cascadia Mono', 'Cascadia Code', Consolas, 'JetBrains Mono', monospace",
  fontSize: '12px',
  lineHeight: 1.55,
}
const colors = {
  ok: 'var(--ui-color-ok, #22c55e)',
  warn: 'var(--ui-color-warning, #f59e0b)',
  down: 'var(--ui-color-error, #ef4444)',
}
const styles = {
  pane: { ...mono, display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem', height: '100%', overflow: 'auto', color: 'var(--ui-text-primary)' },
  chip: { ...mono, display: 'inline-flex', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent', color: 'var(--ui-text-primary)', cursor: 'pointer', font: 'inherit', padding: '0 6px' },
  header: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  title: { fontWeight: 650, letterSpacing: '-0.01em' },
  endpoint: { color: 'var(--ui-text-secondary)', fontSize: '11px' },
  sectionTitle: { color: 'var(--ui-text-secondary)', fontWeight: 600, borderTop: '1px solid var(--ui-stroke-tertiary)', paddingTop: '0.5rem' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '12px' },
  label: { color: 'var(--ui-text-secondary)' },
  recentRow: { display: 'grid', gridTemplateColumns: '58px 52px 46px 48px 128px 1fr', gap: '8px', alignItems: 'baseline' },
  // the phase value is prose ("Waiting Reply"), so it gets its own row shape: auto-width,
  // never wrapped, with real air before the waiting label
  phaseRow: { display: 'grid', gridTemplateColumns: '58px max-content 46px 1fr', columnGap: '16px', alignItems: 'baseline', whiteSpace: 'nowrap' },
  statRow: { display: 'grid', gridTemplateColumns: '58px 1fr', gap: '8px', alignItems: 'baseline' },
  // generated carries a 30-cell bar, so its value and bar are auto-width and never wrapped
  genRow: { display: 'grid', gridTemplateColumns: '58px max-content 1fr', columnGap: '12px', alignItems: 'baseline', whiteSpace: 'nowrap' },
  footer: { marginTop: 'auto', color: 'var(--ui-text-tertiary)', fontSize: '11px', borderTop: '1px solid var(--ui-stroke-tertiary)', paddingTop: '0.5rem' },
  alert: { color: colors.warn },
  dot: (state) => ({ width: '8px', height: '8px', borderRadius: '50%', background: state === 'ok' ? colors.ok : state === 'warn' ? colors.warn : colors.down, flexShrink: 0 }),
}

// formatters — mirror tools.py so the terminal frame and the pane agree
const fmtTok = (n) => {
  n = Number(n || 0)
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
const rate = (v, unit = 't/s') => {
  v = Number(v || 0)
  if (v <= 0) return '-'
  return (v >= 1000 ? v.toFixed(0) : v.toFixed(1)) + ' ' + unit
}
// prefill and decode get their own lines, so an inactive phase reads --/-- rather than a bare dash
const rateOrDash = (v, unit = 't/s') => (Number(v || 0) > 0 ? rate(v, unit) : '--/--')
const bar = (v, peak, cells = 14) => {
  v = Number(v || 0)
  peak = Number(peak || 0)
  const f = peak <= 0 ? 0 : Math.max(0, Math.min(1, v / peak))
  const filled = Math.round(cells * f)
  return '#'.repeat(filled) + '.'.repeat(cells - filled)
}
const age = (fetched_at) => {
  const s = Math.max(0, Math.round((Date.now() / 1000) - Number(fetched_at || 0)))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m${s % 60 ? ' ' + (s % 60) + 's' : ''} ago`
}
const dash = (v) => (v === undefined || v === null || v === '' ? '-' : String(v))

// queries — poll interval comes from the plugin's own resolved settings
const useSettings = () => useQuery({ queryKey: [PLUGIN_ID, 'settings'], queryFn: () => ctxRest('/settings') })
const useStatus = (settings) =>
  useQuery({
    queryKey: [PLUGIN_ID, 'status'],
    queryFn: () => ctxRest('/status'),
    refetchInterval: Math.max(2, Number((settings && settings.poll_interval_seconds) || 5)) * 1000,
  })
async function ctxRest(path) {
  // ctx is captured into register(); helpers stay outside components on purpose.
  return _ctx.rest(path)
}
let _ctx = null

function Row({ label, value, warn }) {
  return jsxs('div', { style: styles.row, children: [jsx('span', { style: styles.label, children: label }), jsx('span', { style: warn ? { color: colors.warn } : undefined, children: value })] })
}

function Section({ title, children }) {
  return jsxs('div', { children: [jsx('div', { style: styles.sectionTitle, children: title }), children] })
}

function Panel() {
  const settings = useSettings().data
  const { data } = useStatus(settings)
  const st = (data && data.status) || {}
  const state = (data && data.state) || 'down'
  const alerts = (data && data.alerts) || []
  const server = st.server || {}
  const task = st.task || {}
  const system = st.system || {}
  const engine = st.engine || {}
  const recent = Array.isArray(st.recent) ? st.recent : []
  const name = String(server.model || '-').replace(/\\/g, '/').split('/').pop()
  const recentPeak = useMemo(() => Math.max(26, ...recent.map((r) => Number(r.decode_tps || 0))), [recent])
  const commitWarn = Number((settings && settings.commit_warn_percent) || 90)

  return jsxs('div', { style: styles.pane, children: [
    jsxs('div', { style: styles.header, children: [
      jsx('span', { style: styles.dot(state), title: state }),
      jsx('span', { style: styles.title, children: 'strata-top' }),
      jsx('span', { style: styles.endpoint, children: (data && data.endpoint) || '' }),
    ] }),
    data && data.error
      ? jsx('div', { style: { color: colors.down }, children: `no contact — ${data.error} · the view recovers on its own` })
      : null,
    jsx(Section, { title: 'CURRENT TASK', children: jsxs('div', { children: [
      jsxs('div', { style: styles.phaseRow, children: [jsx('span', { style: styles.label, children: 'phase' }), jsx('span', { children: dash(task.phase) }), jsx('span', { style: styles.label, children: 'waiting' }), jsx('span', { children: dash(task.waiting) })] }),
      jsxs('div', { style: styles.statRow, children: [jsx('span', { style: styles.label, children: 'prefill' }), jsx('span', { children: rateOrDash(task.prefill_tps) })] }),
      jsxs('div', { style: styles.statRow, children: [jsx('span', { style: styles.label, children: 'decode' }), jsx('span', { children: rateOrDash(task.decode_tps) })] }),
      jsxs('div', { style: styles.recentRow, children: [jsx('span', { style: styles.label, children: 'ctx' }), jsx('span', { children: fmtTok(task.prompt_tokens) }), jsx('span', { style: styles.label, children: 'cache' }), jsx('span', { children: fmtTok(task.cached) })] }),
      jsxs('div', { style: styles.statRow, children: [jsx('span', { style: styles.label, children: 'drafts' }), jsx('span', { children: Number(task.draft_pct) >= 0 ? `${task.draft_pct}% accepted` : '-' })] }),
      Number(task.max_tokens || 0) > 0
        ? jsxs('div', { style: styles.genRow, children: [jsx('span', { style: styles.label, children: 'generated' }), jsx('span', { children: `${fmtTok(task.gen_tokens)} / ${fmtTok(task.max_tokens)}` }), jsx('span', { children: `[${bar(task.gen_tokens, task.max_tokens, 30)}]` })] })
        : null,
    ] }) }),
    jsx(Section, {
      title: `RECENT REQUESTS (${recent.length})`,
      children: recent.length === 0
        ? jsx('div', { style: { color: 'var(--ui-text-secondary)' }, children: data && data.error ? '-' : 'no completed requests yet' })
        : recent.slice(0, 10).map((r, i) => jsxs('div', { style: styles.recentRow, children: [
            jsx('span', { children: dash(r.clock) }),
            jsx('span', { children: fmtTok(r.prompt_n) }),
            jsx('span', { children: fmtTok(r.gen_n) }),
            jsx('span', { children: Number(r.decode_tps || 0).toFixed(1) }),
            jsx('span', { children: `[${bar(r.decode_tps, recentPeak)}]` }),
            jsx('span', { style: { color: 'var(--ui-text-secondary)' }, children: dash(r.finish) }),
          ] }, i)),
    }),
    jsx(Section, { title: 'SYSTEM', children: [
      jsx(Row, { label: 'COMMIT', value: `${(Number(system.commit_total_mib || 0) / 1024).toFixed(1)} / ${(Number(system.commit_limit_mib || 0) / 1024).toFixed(1)} GB  ${Number(system.commit_pct || 0).toFixed(1)}%` }),
      jsx(Row, { label: 'headroom', value: `${(Number(system.commit_headroom_mib || 0) / 1024).toFixed(1)} GB`, warn: Number(system.commit_pct || 0) >= commitWarn }),
      jsx(Row, { label: 'RAM', value: `${(Number(system.ram_total_mib || 0) / 1024).toFixed(1)} GB total · free ${(Number(system.ram_avail_mib || 0) / 1024).toFixed(1)} GB`, warn: Number(system.ram_avail_mib || 0) / 1024 < 4 }),
      alerts.length ? jsxs('div', { style: styles.alert, children: ['⚠ ', alerts.join(' · ')] }) : null,
    ] }),
    jsx(Section, { title: 'ENGINE', children: [
      jsx(Row, { label: 'expert cache hit', value: Number(engine.expert_hit_pct) >= 0 ? `${engine.expert_hit_pct}%` : '-' }),
      jsx(Row, { label: 'over PCIe', value: Number(engine.pcie_pct) >= 0 ? `${engine.pcie_pct}%` : '-' }),
      jsx(Row, { label: 'KV in VRAM', value: Number(engine.kv_vram_hit_pct) >= 0 ? `${engine.kv_vram_hit_pct}%` : '-' }),
      jsx(Row, { label: 'from RAM', value: Number(engine.kv_from_ram_mib) >= 0 ? `${Math.round(Number(engine.kv_from_ram_mib))} MiB` : '-' }),
    ] }),
    jsxs('div', { style: styles.footer, children: [
      jsxs('div', { children: ['model ', name, ' · ctx ', fmtTok(server.max_context), ' · up ', Math.round(Number(server.uptime_s || 0)), 's · ', server.busy ? 'busy' : 'idle'] }),
      jsx('div', { children: data ? `updated ${age(data.fetched_at)} · settings: Settings → Plugins → strata-top` : '' }),
    ] }),
  ] })
}

function Chip() {
  const settings = useSettings().data
  const { data } = useStatus(settings)
  if (settings && settings.show_chip === false) return null
  const state = (data && data.state) || 'down'
  const alerts = (data && data.alerts) || []
  const tip = alerts.length ? `strata-top: ${alerts.join(' · ')}` : 'strata-top — right rail'
  return jsx('button', {
    style: styles.chip,
    title: tip,
    onClick: () => ctxRunAction('view.toggleRightSidebar'),
    children: jsxs('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' }, children: [jsx('span', { style: styles.dot(state) }), 'strata'] }),
  })
}
function ctxRunAction(id) {
  const r = _ctx.runAction(id)
  if (r && !r.ok) host.logs.warn(`strata-top: action ${id} refused (${r.reason})`)
}

function SettingsPeek() {
  const { data } = useQuery({ queryKey: [PLUGIN_ID, 'settings'], queryFn: () => ctxRest('/settings') })
  const s = data || {}
  return jsxs('div', { style: { ...mono, padding: '1rem', color: 'var(--ui-text-primary)' }, children: [
    jsx(Badge, { variant: 'muted', children: 'resolved settings (live from the backend)' }),
    jsxs('div', { style: { marginTop: '0.75rem' }, children: [
      jsx(Row, { label: 'endpoint', value: s.endpoint || '-' }),
      jsx(Row, { label: 'poll_interval_seconds', value: String(s.poll_interval_seconds ?? '-') }),
      jsx(Row, { label: 'commit_warn_percent', value: String(s.commit_warn_percent ?? '-') }),
      jsx(Row, { label: 'show_chip', value: String(s.show_chip ?? '-') }),
    ] }),
    jsx('div', { style: { marginTop: '0.75rem', color: 'var(--ui-text-secondary)' }, children: 'Edit on the Agent settings sub-page of this entry (Settings → Plugins). Saved values land here live via plugins.manage settings.' }),
  ] })
}

export default {
  id: PLUGIN_ID,
  name: 'Strata Top',
  version: '0.1.0',
  register(context) {
    _ctx = context
    context.registerMany([
      { id: 'pane', area: 'panes', title: 'strata-top', data: { placement: 'right', width: '300px' }, render: () => jsx(Panel, {}) },
      { id: 'chip', area: STATUSBAR_AREAS.right, order: 120, render: () => jsx(Chip, {}) },
      { id: 'open', area: PALETTE_AREA, data: { id: 'strata-top.open', label: 'Show strata-top pane', keywords: ['strata', 'telemetry', 'pane'], run: () => ctxRunAction('view.toggleRightSidebar') } },
      { id: 'settings', area: PALETTE_AREA, data: { id: 'strata-top.settings', label: 'Open strata-top settings', keywords: ['strata', 'settings'], run: () => host.navigate(pluginSettingsHref(PLUGIN_ID)) } },
    ])
    if (typeof context.registerSettingsPage === 'function') {
      context.registerSettingsPage({ id: 'settings-page', title: 'Strata Top', icon: 'gear', render: () => jsx(SettingsPeek, {}) })
    }
  },
}
