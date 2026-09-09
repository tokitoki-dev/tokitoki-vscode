import * as vscode from 'vscode';

import { Logger } from './logger';
import { readProjectName } from './projectFile';
import { TOKITOKI_BASE_URL } from './serverUrl';
import { StatsDaily, StatsReport, TokitokiCli } from './tokitokiCli';

/** Days of local history the panel reads, and the only window it ever shows.
 * A week is what a person can hold in their head and what labels cleanly at
 * sidebar width; anything longer is the dashboard's job, not a sidebar's. */
const STATS_DAYS = 7;

/** How many rows each ranking shows. The full list is one click away on the
 * dashboard; a sidebar ranks, it does not enumerate. */
const TOP_PROJECTS = 5;
const TOP_MODELS = 3;

/** Selector value meaning "no project scope". A newline can appear in neither
 * a folder name nor a pinned `.tokitoki` name — that file's first line is the
 * name — so this never collides with a real project. */
const ALL_PROJECTS = '\nall';

// One color per identity, everywhere it appears: time is always green, AI
// tokens always blue. A chart never mixes the two, so no legend is needed —
// the section title names the single series.
const TIME_COLOR = 'var(--vscode-charts-green, #89d185)';
const AI_COLOR = 'var(--vscode-charts-blue, #3794ff)';

/**
 * Sidebar webview rendering usage from `tokitoki stats` — local data only, so
 * it shows something real before an API key exists.
 *
 * It serves two readers with one layout: today's numbers and a streak up top
 * for the returning user, then the week's rhythm and what the time and tokens
 * went to — the part that gives a newcomer something to recognise in their own
 * habits. Both readers end at the same card, because both have the same next
 * step: the week is all a sidebar shows, and the full breakdown belongs on the
 * dashboard, which is what the panel is here to sell.
 */
export class StatsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'tokitoki.statsView';

  private view: vscode.WebviewView | undefined;
  private refreshing = false;
  private scanned = false;
  /** The project the user picked from the selector, overriding the folder open
   * in this window. `undefined` follows the window; `ALL_PROJECTS` is the
   * explicit global view. */
  private selected: string | undefined;

  constructor(
    private readonly createCli: () => TokitokiCli,
    private readonly logger: Logger,
  ) {}

  /** The first scan has finished, so an empty report now means "nothing to
   * show" rather than "not looked yet". Until this flips, an empty panel
   * says it is still scanning — the history lives in the AI tools' own log
   * directories and takes a moment to read. */
  public markScanned(): void {
    this.scanned = true;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: { command?: string; value?: string }) => {
      switch (message?.command) {
        case 'selectProject':
          // The empty value is the "follow this window" entry; anything else
          // is a project name to pin, including the all-projects sentinel.
          this.selected = message.value ? message.value : undefined;
          void this.refresh();
          break;
        case 'setApiKey':
          void vscode.commands.executeCommand('tokitoki.setApiKey');
          break;
        case 'openDashboard':
          void vscode.commands.executeCommand('tokitoki.openDashboard');
          break;
        case 'setProjectName':
          void vscode.commands.executeCommand('tokitoki.setProjectName');
          break;
        case 'openWebsite':
          // Onboarding step 1 — the account/key page, not the dashboard.
          // The dashboard jump stays behind a configured key.
          void vscode.env.openExternal(vscode.Uri.parse(TOKITOKI_BASE_URL));
          break;
        case 'refresh':
          void this.refresh();
          break;
      }
    });
    // Collapsing and reopening the view keeps the provider but re-resolves
    // visibility; refresh on the way back so the numbers are not stale.
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.refresh();
      }
    });
    void this.refresh();
  }

  /** Re-renders from the CLI. Safe to call when the view is closed (no-op)
   * or mid-refresh (coalesced). */
  public async refresh(): Promise<void> {
    const view = this.view;
    if (!view || this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      let apiKeyMissing = false;
      try {
        await this.createCli().getApiKey();
      } catch {
        apiKeyMissing = true;
      }

      // Which project the panel reads: the selector wins, otherwise the folder
      // open in this window — the name the CLI's heartbeats record, being the
      // folder's pinned `.tokitoki` name when set and the folder name
      // otherwise. `ALL_PROJECTS` asks for no sub-report at all. One CLI call
      // returns the global report with that sub-report nested inside it.
      const windowProject = await this.currentProjectName();
      const active = this.selected ?? windowProject;
      const projectName = active === ALL_PROJECTS ? undefined : active;
      let report: StatsReport;
      try {
        report = await this.createCli().stats(STATS_DAYS, projectName);
      } catch (error) {
        this.logger.debug(`Stats unavailable: ${error instanceof Error ? error.message : String(error)}`);
        // Old shared CLI without the stats command, or a broken install.
        // Either way the fix is the same and the view says so.
        view.webview.html = this.page(
          banner(vscode.l10n.t('Usage stats need a newer Tokitoki CLI. It updates itself within a day, or run: tokitoki update')),
          view.webview,
        );
        return;
      }

      view.webview.html = this.page(
        renderPanel({
          report,
          projectReport: report.project,
          projectName,
          windowProject,
          apiKeyMissing,
          scanned: this.scanned,
        }),
        view.webview,
      );
    } finally {
      this.refreshing = false;
    }
  }

  private async currentProjectName(): Promise<string | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    try {
      return (await readProjectName(folder.uri.fsPath)) || folder.name;
    } catch {
      return folder.name;
    }
  }

  private page(body: string, webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style>
</head>
<body>
${body}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
}
for (const select of document.querySelectorAll('[data-select="project"]')) {
  select.addEventListener('change', () => vscode.postMessage({ command: 'selectProject', value: select.value }));
}
</script>
</body>
</html>`;
  }
}

interface PanelState {
  /** Every project, always — the selector lists from this even while the panel
   * shows one project. */
  report: StatsReport;
  /** The same window narrowed to one project, when one is selected. */
  projectReport: StatsReport | undefined;
  /** The project the panel is scoped to, or undefined for all projects. */
  projectName: string | undefined;
  /** The project belonging to the folder open in this window, whether or not
   * it is the one being shown. */
  windowProject: string | undefined;
  apiKeyMissing: boolean;
  scanned: boolean;
}

function renderPanel({
  report,
  projectReport,
  projectName,
  windowProject,
  apiKeyMissing,
  scanned,
}: PanelState): string {
  // Nothing recorded yet has two very different meanings, and the wrong one
  // reads as a broken product on a fresh install: before the first scan the
  // history simply has not been read, and saying so promises something is
  // coming. Only after a completed scan is "no activity" the truth.
  if (report.totals.events === 0) {
    // Mid-scan there is nothing to point at yet: the card sends the reader to
    // a dashboard for more than the panel shows, and the panel does not yet
    // know what it shows. Once the scan lands empty, the card is all there is
    // to offer.
    if (!scanned) {
      return layout([banner(vscode.l10n.t('Reading your local coding and AI history…'))]);
    }
    return layout([
      banner(vscode.l10n.t('No activity recorded yet. Stats appear as you code and use AI tools.')),
      dashboardCard(apiKeyMissing),
    ]);
  }

  // The selector sets the scope for the whole panel, so every section reads
  // one report and none of them has to explain which numbers it is showing.
  // Picking a project also makes the projects ranking pointless — it would be
  // a chart of one bar — so it only appears in the all-projects view.
  const scope = projectReport ?? report;
  const blocks = [
    projectSelector(report, projectName, windowProject),
    renderHeadline(scope),
    renderWeek(scope),
    projectReport ? '' : renderTopProjects(report),
    renderTopModels(scope),
    dashboardCard(apiKeyMissing),
  ].filter(Boolean);

  return layout(blocks);
}

/**
 * One column of sections, the last of which is the call to action — it follows
 * the data instead of being pinned to the bottom edge, so it reads as the end
 * of the panel rather than a bar floating over it.
 *
 * Gaps grow with the panel's height, within a limit, so a tall sidebar spreads
 * the sections out instead of stacking them under one long stretch of empty.
 * On a short panel the gaps collapse and the view scrolls — spacing is what
 * gives, never the content.
 */
function layout(blocks: string[]): string {
  return `
<div class="content">
${blocks.map((block) => `<div class="block">\n${block}\n</div>`).join('\n')}
</div>`;
}

/**
 * The scope picker. The folder open in this window leads the list — it is the
 * one the reader is most likely to want and the panel's default — followed by
 * every other project with recorded time, most active first.
 *
 * Selecting is a filter, not a preference: it lives for as long as the view
 * does. Reopening the sidebar starts from the current window again, which is
 * the behaviour someone switching between windows expects.
 */
function projectSelector(
  report: StatsReport,
  active: string | undefined,
  windowProject: string | undefined,
): string {
  const ranked = [...report.projects]
    .filter((group) => group.active_seconds > 0)
    .sort((a, b) => b.active_seconds - a.active_seconds)
    .map((group) => group.name);

  // The window's own project heads the list even when it has no recorded time
  // yet — a folder you just opened must still be selectable.
  const names = [
    ...(windowProject ? [windowProject] : []),
    ...ranked.filter((name) => name !== windowProject),
  ];
  if (names.length === 0) {
    return '';
  }

  // What is actually on screen, expressed as an option value: `active` is the
  // resolved scope, so it already accounts for both the selection and the
  // window fallback. Exactly one option can match it.
  const current = active ?? ALL_PROJECTS;
  const options = [
    { value: ALL_PROJECTS, label: vscode.l10n.t('All projects') },
    ...names.map((name) => ({
      value: name,
      label: name === windowProject ? vscode.l10n.t('{0} (this window)', name) : name,
    })),
  ];
  const rendered = options
    .map(({ value, label }) =>
      `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
  return `<select class="project-select" data-select="project" title="${escapeHtml(vscode.l10n.t('Choose which project the panel shows'))}">${rendered}</select>`;
}

/**
 * Today, in three numbers. This is the whole panel for a returning user with a
 * key: open the sidebar, see how the day is going, close it. Which project
 * these describe is the selector's business, so the headline never repeats it.
 */
function renderHeadline(report: StatsReport): string {
  const today = report.daily[report.daily.length - 1];
  const streak = codingStreak(report.daily);

  return `
<div class="headline">
  <div class="tiles">
    ${tile(vscode.l10n.t('Today'), formatDuration(today?.active_seconds ?? 0), TIME_COLOR)}
    ${tile(vscode.l10n.t('Tokens'), formatTokens(today?.total_tokens ?? 0), AI_COLOR)}
    ${tile(vscode.l10n.t('Streak'), streakValue(streak), '')}
  </div>
</div>`;
}

/** Consecutive days with coding activity, counting back from the most recent
 * day. Today not having started yet must not break a run, so a zero on the
 * final day is skipped rather than ending the count at zero. */
function codingStreak(daily: StatsDaily[]): number {
  let streak = 0;
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (daily[i].active_seconds > 0) {
      streak += 1;
    } else if (i !== daily.length - 1) {
      break;
    }
  }
  return streak;
}

/** A streak that fills the whole window is a floor, not a total — the history
 * simply does not reach further back, and "14d" would understate it. */
function streakValue(streak: number): string {
  const capped = streak >= STATS_DAYS;
  return `${capped ? `${STATS_DAYS}+` : streak}<span class="unit">${escapeHtml(vscode.l10n.t('d'))}</span>`;
}

/**
 * The past week as bars, one per day, labelled with the weekday. Height is
 * directly comparable — twice as tall is twice as long — where a shaded grid
 * makes the reader decode a colour scale before learning anything. This plots
 * the panel's whole window; the longer history is the dashboard's job.
 */
function renderWeek(report: StatsReport): string {
  // Always the full window: the report pads days with no activity to zero, so
  // this is STATS_DAYS bars whether or not the history reaches back that far.
  const days = report.daily;
  const max = Math.max(...days.map((day) => day.active_seconds), 1);
  const columns = days
    .map((day, index) => {
      const label = `${day.date} · ${formatDuration(day.active_seconds)} · ${formatTokens(day.total_tokens)}`;
      const isToday = index === days.length - 1;
      return `
<div class="day${isToday ? ' today' : ''}" title="${escapeHtml(label)}">
  <div class="day-bar"><div class="day-fill" style="height:${percent(day.active_seconds, max)}%"></div></div>
  <div class="day-name">${escapeHtml(weekdayInitial(day.date))}</div>
</div>`;
    })
    .join('');
  const total = formatDuration(sum(days.map((day) => day.active_seconds)));
  return [
    sectionTitle(vscode.l10n.t('Last {0} days', days.length), total),
    `<div class="week">${columns}</div>`,
  ].join('\n');
}

/** The weekday letter for a `YYYY-MM-DD` day, in the user's locale. Parsed as
 * local time — `new Date('2026-08-27')` is UTC midnight, which lands on the
 * previous day for anyone west of Greenwich and would label every bar wrong. */
function weekdayInitial(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    return '';
  }
  return new Date(year, month - 1, day)
    .toLocaleDateString(vscode.env.language, { weekday: 'narrow' });
}

/**
 * Where the time went, ranked. The total on the right is the count of every
 * project touched, not the visible five: "31 total" is the fact a sidebar
 * cannot show and the dashboard can, which makes the ranking both useful now
 * and an argument for clicking through.
 */
function renderTopProjects(report: StatsReport): string {
  const projects = [...report.projects]
    .filter((group) => group.active_seconds > 0)
    .sort((a, b) => b.active_seconds - a.active_seconds);
  if (projects.length < 2) {
    return '';
  }
  const top = projects.slice(0, TOP_PROJECTS);

  // Two bars per project, each scaled against its own leader: time in green,
  // tokens in blue. Read together they answer the question neither answers
  // alone — where the hours went, and where the AI went. A project heavy on
  // one and light on the other is the interesting case, and it only shows up
  // when both bars share a row.
  const maxTime = Math.max(...top.map((group) => group.active_seconds), 1);
  const maxTokens = Math.max(...top.map((group) => group.total_tokens), 1);
  const rows = top
    .map((group) => {
      const label = `${group.name} · ${formatDuration(group.active_seconds)} · ${formatTokens(group.total_tokens)}`;
      return `
<div class="row" title="${escapeHtml(label)}">
  <div class="row-text">
    <span class="row-name">${escapeHtml(group.name)}</span>
    <span class="row-value">${escapeHtml(formatDuration(group.active_seconds))}</span>
  </div>
  <div class="row-track"><div class="row-fill" style="width:${percent(group.active_seconds, maxTime)}%;background:${TIME_COLOR}"></div></div>
  <div class="row-track thin"><div class="row-fill" style="width:${percent(group.total_tokens, maxTokens)}%;background:${AI_COLOR}"></div></div>
</div>`;
    })
    .join('');

  return [
    sectionTitle(vscode.l10n.t('Projects'), vscode.l10n.t('{0} total', projects.length)),
    `<div class="rows">${rows}</div>`,
  ].join('\n');
}

/**
 * Which models the tokens went to — the fact users cannot get from their
 * editor, and the clearest preview of what the dashboard does.
 */
function renderTopModels(report: StatsReport): string {
  const models = report.models
    .filter((group) => group.total_tokens > 0)
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, TOP_MODELS);
  if (models.length === 0) {
    return '';
  }
  return [
    sectionTitle(vscode.l10n.t('Top models'), formatTokens(report.totals.total_tokens)),
    rankedRows(
      models.map((group) => ({
        name: group.name,
        value: group.total_tokens,
        formatted: formatTokens(group.total_tokens),
      })),
      AI_COLOR,
    ),
  ].join('\n');
}

/** A bar width, floored so a nonzero value always leaves a visible mark —
 * rounding a real number down to an empty track is a lie. */
function percent(value: number, max: number): string {
  if (value === 0) {
    return '0';
  }
  return Math.max((value / max) * 100, 2).toFixed(1);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The panel's one exit, identical whether or not a key is set. The sidebar
 * summarises a week and stops there; everything past that — longer history,
 * every device, the full breakdown — is the dashboard's, and this says so
 * once instead of the panel growing features to avoid saying it.
 *
 * Without a key the same card carries a second, quieter button. The primary
 * one still opens the site, which is where a keyless visitor can actually
 * start: the key page sits behind a login they do not have yet.
 */
function dashboardCard(apiKeyMissing: boolean): string {
  const keyButton = apiKeyMissing
    ? `\n  <button class="quiet" data-command="setApiKey">${escapeHtml(vscode.l10n.t('I have an API key'))}</button>`
    : '';
  return `
<div class="cta">
  <p>${escapeHtml(vscode.l10n.t('See more on your Dashboard.'))}</p>
  <button data-command="${apiKeyMissing ? 'openWebsite' : 'openDashboard'}">${escapeHtml(vscode.l10n.t('Open Dashboard'))}</button>${keyButton}
</div>`;
}

/** Rows sharing one scale, widest first. Names come from user data — project
 * folders and model ids — so every one is escaped. */
function rankedRows(
  rows: Array<{ name: string; value: number; formatted: string }>,
  color: string,
): string {
  const max = Math.max(...rows.map((row) => row.value), 1);
  const items = rows
    .map((row) => `
<div class="row" title="${escapeHtml(`${row.name} · ${row.formatted}`)}">
  <div class="row-text"><span class="row-name">${escapeHtml(row.name)}</span><span class="row-value">${escapeHtml(row.formatted)}</span></div>
  <div class="row-track"><div class="row-fill" style="width:${percent(row.value, max)}%;background:${color}"></div></div>
</div>`)
    .join('');
  return `<div class="rows">${items}</div>`;
}

/** A section heading with its own total on the right, so each block states its
 * scale without spending a tile on it. */
function sectionTitle(title: string, total: string): string {
  return `<div class="section-title"><h3>${escapeHtml(title)}</h3><span class="section-total">${escapeHtml(total)}</span></div>`;
}

/** `value` is trusted markup — callers pass either an escaped number or a
 * value with its own unit span. Everything derived from user data (project
 * and model names) goes through the escaping helpers at its own call site. */
function tile(label: string, value: string, color: string): string {
  const style = color ? ` style="color:${color}"` : '';
  return `<div class="tile"><div class="tile-value"${style}>${value}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

function banner(text: string): string {
  return `<div class="banner">${escapeHtml(text)}</div>`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getNonce(): string {
  let nonce = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

const STYLE = `
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  font-size: var(--vscode-font-size);
  padding: 8px 12px 16px;
  margin: 0;
  box-sizing: border-box;
}
/* Takes the slack so the CTA rests on the bottom edge of a short panel, and
   yields it back — scrolling normally — once the data outgrows the view. */
/* One column of sections. The gap grows a little with the panel's height so a
   tall sidebar does not stack everything at the top, but stops well short of
   stranding the blocks as unrelated islands. */
.content { display: flex; flex-direction: column; }
.block + .block { margin-top: min(4vh, 34px); }
.block > *:last-child { margin-bottom: 0; }
h3 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}

/* Uses the editor's own dropdown colours so it reads as part of VS Code
   rather than a web form dropped into the sidebar. */
.project-select {
  width: 100%;
  margin-bottom: 10px;
  padding: 3px 6px;
  border: 1px solid var(--vscode-dropdown-border, transparent);
  border-radius: 2px;
  background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.project-select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.scope {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 6px;
}
.section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.section-total {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.tile {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 4px;
  padding: 8px 10px;
}
.tile-value { font-size: 16px; font-weight: 600; }
.tile-value .unit { font-size: 11px; font-weight: 400; color: var(--vscode-descriptionForeground); margin-left: 1px; }
.tile-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
/* One column per day, bar plus label. Heights are comparable directly, so
   there is no scale to decode. */
.week {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.day-bar { width: 100%; height: 72px; display: flex; align-items: flex-end; }
.day-fill {
  width: 100%;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
  background: ${TIME_COLOR};
  opacity: 0.55;
}
.day-name { font-size: 10px; color: var(--vscode-descriptionForeground); }
/* Today is the bar the reader is looking for, so it alone is at full strength
   and its label is not dimmed. */
.day.today .day-fill { opacity: 1; }
.day.today .day-name { color: var(--vscode-foreground); }

.row { margin-bottom: 8px; }
.row:last-child { margin-bottom: 0; }
.row-text { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 2px; }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-value { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.row-track { height: 4px; border-radius: 2px; background: var(--vscode-editorWidget-background); }
/* The token bar rides under the time bar, slimmer so the row still reads as
   one entry with a primary measure rather than two competing charts. */
.row-track.thin { height: 3px; margin-top: 2px; opacity: 0.85; }
.row-fill { height: 100%; border-radius: 2px; }
button {
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 2px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
.cta {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 4px;
  padding: 12px;
}
.cta p {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
}
button.quiet {
  margin-top: 6px;
  background: transparent;
  color: var(--vscode-textLink-foreground);
}
button.quiet:hover {
  background: var(--vscode-toolbar-hoverBackground, transparent);
  text-decoration: underline;
}
.banner { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 8px 0; }
`;
