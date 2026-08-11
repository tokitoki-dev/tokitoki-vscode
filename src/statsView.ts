import * as vscode from 'vscode';

import { Logger } from './logger';
import { readProjectName } from './projectFile';
import { TOKITOKI_BASE_URL } from './serverUrl';
import { StatsReport, TokitokiCli } from './tokitokiCli';

/** Days of local history the view renders. Matches what fits a sidebar. */
const STATS_DAYS = 14;

/** How many models/projects the top lists show. The full list is one click
 * away on the dashboard; a sidebar ranks, it does not enumerate. */
const TOP_LIST_LIMIT = 5;

// One color per identity, everywhere it appears: time is always green, AI
// tokens always blue. A chart never mixes the two, so no legend is needed —
// the section title names the single series.
const TIME_COLOR = 'var(--vscode-charts-green, #89d185)';
const AI_COLOR = 'var(--vscode-charts-blue, #3794ff)';

/**
 * Sidebar webview rendering usage charts from `tokitoki stats` — local data
 * only, so a fresh install shows something real before an API key exists.
 *
 * Layout is time first, AI second: every user of an editor produces coding
 * time, while AI usage may be zero, and a panel that leads with its
 * emptiest section reads as broken. When the key is missing, the view
 * carries the setup call-to-action; that is deliberate: the charts
 * demonstrate the value, the button asks for the key.
 */
export class StatsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'tokitoki.statsView';

  private view: vscode.WebviewView | undefined;
  private refreshing = false;

  constructor(
    private readonly createCli: () => TokitokiCli,
    private readonly logger: Logger,
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: { command?: string }) => {
      switch (message?.command) {
        case 'setApiKey':
          void vscode.commands.executeCommand('tokitoki.setApiKey');
          break;
        case 'openDashboard':
          void vscode.commands.executeCommand('tokitoki.openDashboard');
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

      // The time zone is scoped to the project open in this window — the
      // name the CLI's heartbeats record: the folder's pinned `.tokitoki`
      // name when set, the folder name otherwise. One CLI call returns the
      // global report with the project sub-report nested inside it.
      const projectName = await this.currentProjectName();
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
        renderPanel(report, report.project, projectName, apiKeyMissing),
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
</script>
</body>
</html>`;
  }
}

function renderPanel(
  report: StatsReport,
  projectReport: StatsReport | undefined,
  projectName: string | undefined,
  apiKeyMissing: boolean,
): string {
  const sections: string[] = [];

  if (report.totals.events === 0) {
    sections.push(banner(vscode.l10n.t('No activity recorded yet. Stats appear as you code and use AI tools.')));
  } else {
    sections.push(renderTimeZone(report, projectReport, projectName));
    sections.push('<div class="divider"></div>');
    sections.push(renderAiZone(report));
  }

  // The panel ends on its one call to action: connect a key, or jump to the
  // dashboard that key unlocked. The stats come first — they are the reason
  // to bother connecting.
  if (apiKeyMissing) {
    sections.push('<div class="divider"></div>');
    sections.push(onboardingCard());
  } else {
    sections.push(`
<div class="footer">
  <button data-command="openDashboard">${escapeHtml(vscode.l10n.t('Open Dashboard'))}</button>
</div>`);
  }

  return sections.filter(Boolean).join('\n');
}

/** Coding time, scoped to the current project when one is open. Global
 * context stays available through the projects-by-time ranking below. */
function renderTimeZone(
  report: StatsReport,
  projectReport: StatsReport | undefined,
  projectName: string | undefined,
): string {
  const scoped = projectReport ?? report;
  const scopeLabel = projectReport && projectName ? projectName : vscode.l10n.t('All projects');
  const today = scoped.daily[scoped.daily.length - 1];

  const parts = [
    zoneTitle(vscode.l10n.t('Coding Time'), scopeLabel),
    `<div class="tiles">
  ${tile(vscode.l10n.t('Active today'), formatDuration(today?.active_seconds ?? 0))}
  ${tile(vscode.l10n.t('Active, {0} days', scoped.days), formatDuration(scoped.totals.active_seconds))}
</div>`,
    barChart(
      vscode.l10n.t('Daily active time'),
      scoped.daily.map((day) => ({
        label: `${day.date} · ${formatDuration(day.active_seconds)}`,
        value: day.active_seconds,
      })),
      TIME_COLOR,
    ),
    topList(
      vscode.l10n.t('Projects by time'),
      [...report.projects]
        .filter((group) => group.active_seconds > 0)
        .sort((a, b) => b.active_seconds - a.active_seconds)
        .map((group) => ({
          name: group.name,
          value: group.active_seconds,
          formatted: formatDuration(group.active_seconds),
        })),
      TIME_COLOR,
    ),
  ];
  return parts.filter(Boolean).join('\n');
}

/** AI usage is always global: models and tokens are not project-scoped in
 * most tools, and a zero-AI user gets one quiet line instead of dead charts. */
function renderAiZone(report: StatsReport): string {
  if (report.totals.total_tokens === 0) {
    return [
      zoneTitle(vscode.l10n.t('AI Usage'), ''),
      banner(vscode.l10n.t('No AI tool usage detected in the last {0} days.', report.days)),
    ].join('\n');
  }

  const today = report.daily[report.daily.length - 1];
  return [
    zoneTitle(vscode.l10n.t('AI Usage'), ''),
    `<div class="tiles">
  ${tile(vscode.l10n.t('Tokens today'), formatTokens(today?.total_tokens ?? 0))}
  ${tile(vscode.l10n.t('Tokens, {0} days', report.days), formatTokens(report.totals.total_tokens))}
</div>`,
    barChart(
      vscode.l10n.t('Daily AI tokens'),
      report.daily.map((day) => ({
        label: `${day.date} · ${formatTokens(day.total_tokens)}`,
        value: day.total_tokens,
      })),
      AI_COLOR,
    ),
    topList(
      vscode.l10n.t('Top models'),
      report.models
        .filter((group) => group.total_tokens > 0)
        .map((group) => ({
          name: group.name,
          value: group.total_tokens,
          formatted: formatTokens(group.total_tokens),
        })),
      AI_COLOR,
    ),
  ].filter(Boolean).join('\n');
}

/**
 * The keyless state, written as directions rather than mood. The three steps
 * are a real sequence — account, key, paste — so the numbering carries
 * information. "Set API Key" keeps the same name here, in the command
 * palette, and in the input box it opens.
 */
function onboardingCard(): string {
  const steps = [
    vscode.l10n.t('Create an account at tokitoki.dev'),
    vscode.l10n.t('Copy your API key from Settings'),
    vscode.l10n.t('Set it here — syncing starts right away'),
  ];
  return `
<div class="cta">
  <div class="cta-title">${escapeHtml(vscode.l10n.t('Connect to Tokitoki'))}</div>
  <p>${escapeHtml(vscode.l10n.t('These stats live only on this machine. Add your API key to sync them to your Tokitoki dashboard.'))}</p>
  <ol class="steps">
    ${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('\n    ')}
  </ol>
  <button data-command="setApiKey">${escapeHtml(vscode.l10n.t('Set API Key'))}</button>
  <button class="quiet" data-command="openWebsite">${escapeHtml(vscode.l10n.t('Get an API key'))}</button>
</div>`;
}

function zoneTitle(title: string, scope: string): string {
  const chip = scope ? `<span class="zone-scope" title="${escapeHtml(scope)}">${escapeHtml(scope)}</span>` : '';
  return `<div class="zone-title"><h2>${escapeHtml(title)}</h2>${chip}</div>`;
}

function tile(label: string, value: string): string {
  return `<div class="tile"><div class="tile-value">${escapeHtml(value)}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

function barChart(title: string, bars: Array<{ label: string; value: number }>, color: string): string {
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const columns = bars
    .map((bar) => {
      // A day with activity always gets a visible sliver; only a true zero
      // renders as empty. Rounding must not erase real work.
      const percent = bar.value === 0 ? 0 : Math.max((bar.value / max) * 100, 4);
      return `<div class="col" title="${escapeHtml(bar.label)}"><div class="bar" style="height:${percent.toFixed(1)}%;background:${color}"></div></div>`;
    })
    .join('');
  return `<div class="section"><h3>${escapeHtml(title)}</h3><div class="chart">${columns}</div></div>`;
}

function topList(
  title: string,
  rows: Array<{ name: string; value: number; formatted: string }>,
  color: string,
): string {
  const top = rows.slice(0, TOP_LIST_LIMIT);
  if (top.length === 0) {
    return '';
  }
  const max = top[0].value;
  const items = top
    .map((row) => `
<div class="row" title="${escapeHtml(`${row.name} · ${row.formatted}`)}">
  <div class="row-text"><span class="row-name">${escapeHtml(row.name)}</span><span class="row-value">${escapeHtml(row.formatted)}</span></div>
  <div class="row-track"><div class="row-fill" style="width:${((row.value / max) * 100).toFixed(1)}%;background:${color}"></div></div>
</div>`)
    .join('');
  return `<div class="section"><h3>${escapeHtml(title)}</h3>${items}</div>`;
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
  padding: 8px 12px;
}
h2 {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}
h3 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  margin: 0 0 6px;
}
.zone-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.zone-scope {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.divider {
  border-top: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-background));
  margin: 16px 0;
}
.section { margin-bottom: 16px; }
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.tile {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 4px;
  padding: 8px 10px;
}
.tile-value { font-size: 16px; font-weight: 600; }
.tile-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
.chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 56px;
}
.col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
.bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 0; }
.row { margin-bottom: 6px; }
.row-text { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 2px; }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-value { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.row-track { height: 4px; border-radius: 2px; background: var(--vscode-editorWidget-background); }
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
  margin-bottom: 16px;
}
.cta-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.cta p { margin: 0 0 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.steps {
  margin: 0 0 12px;
  padding-left: 18px;
  font-size: 12px;
}
.steps li { margin-bottom: 4px; }
.steps li::marker { color: var(--vscode-descriptionForeground); }
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
.footer { margin-top: 4px; }
`;
