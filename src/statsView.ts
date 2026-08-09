import * as vscode from 'vscode';

import { Logger } from './logger';
import { StatsGroup, StatsReport, TokitokiCli } from './tokitokiCli';

/** Days of local history the view renders. Matches what fits a sidebar. */
const STATS_DAYS = 14;

/** How many models/projects the top lists show. The full list is one click
 * away on the dashboard; a sidebar ranks, it does not enumerate. */
const TOP_LIST_LIMIT = 5;

/**
 * Sidebar webview rendering usage charts from `tokitoki stats` — local data
 * only, so a fresh install shows something real before an API key exists.
 * When the key is missing, the view carries the setup call-to-action; that is
 * deliberate: the charts demonstrate the value, the button asks for the key.
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

      let report: StatsReport;
      try {
        report = await this.createCli().stats(STATS_DAYS);
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

      view.webview.html = this.page(renderReport(report, apiKeyMissing), view.webview);
    } finally {
      this.refreshing = false;
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

function renderReport(report: StatsReport, apiKeyMissing: boolean): string {
  const sections: string[] = [];

  if (apiKeyMissing) {
    sections.push(`
<div class="cta">
  <p>${escapeHtml(vscode.l10n.t('These stats live only on this machine. Add your API key to sync them to your Tokitoki dashboard.'))}</p>
  <button data-command="setApiKey">${escapeHtml(vscode.l10n.t('Set API Key'))}</button>
</div>`);
  }

  if (report.totals.events === 0) {
    sections.push(banner(vscode.l10n.t('No activity recorded yet. Stats appear as you code and use AI tools.')));
    return sections.join('\n');
  }

  const today = report.daily[report.daily.length - 1];
  sections.push(`
<div class="tiles">
  ${tile(vscode.l10n.t('Active today'), formatDuration(today?.active_seconds ?? 0))}
  ${tile(vscode.l10n.t('Tokens today'), formatTokens(today?.total_tokens ?? 0))}
  ${tile(vscode.l10n.t('Active, {0} days', report.days), formatDuration(report.totals.active_seconds))}
  ${tile(vscode.l10n.t('Tokens, {0} days', report.days), formatTokens(report.totals.total_tokens))}
</div>`);

  sections.push(barChart(
    vscode.l10n.t('Daily active time'),
    report.daily.map((day) => ({
      label: `${day.date} · ${formatDuration(day.active_seconds)}`,
      value: day.active_seconds,
    })),
    'var(--vscode-charts-green, #89d185)',
  ));

  sections.push(barChart(
    vscode.l10n.t('Daily AI tokens'),
    report.daily.map((day) => ({
      label: `${day.date} · ${formatTokens(day.total_tokens)}`,
      value: day.total_tokens,
    })),
    'var(--vscode-charts-blue, #3794ff)',
  ));

  sections.push(topList(vscode.l10n.t('Top models'), report.models));
  sections.push(topList(vscode.l10n.t('Top projects'), report.projects));

  if (!apiKeyMissing) {
    sections.push(`
<div class="footer">
  <button data-command="openDashboard">${escapeHtml(vscode.l10n.t('Open Dashboard'))}</button>
</div>`);
  }

  return sections.filter(Boolean).join('\n');
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

function topList(title: string, groups: StatsGroup[]): string {
  const top = groups.filter((group) => group.total_tokens > 0).slice(0, TOP_LIST_LIMIT);
  if (top.length === 0) {
    return '';
  }
  const max = top[0].total_tokens;
  const rows = top
    .map((group) => `
<div class="row" title="${escapeHtml(`${group.name} · ${formatTokens(group.total_tokens)}`)}">
  <div class="row-text"><span class="row-name">${escapeHtml(group.name)}</span><span class="row-value">${escapeHtml(formatTokens(group.total_tokens))}</span></div>
  <div class="row-track"><div class="row-fill" style="width:${((group.total_tokens / max) * 100).toFixed(1)}%"></div></div>
</div>`)
    .join('');
  return `<div class="section"><h3>${escapeHtml(title)}</h3>${rows}</div>`;
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
h3 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  margin: 0 0 6px;
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
.row-fill { height: 100%; border-radius: 2px; background: var(--vscode-charts-purple, #b180d7); }
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
  padding: 10px;
  margin-bottom: 16px;
}
.cta p { margin: 0 0 8px; font-size: 12px; }
.banner { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 8px 0; }
.footer { margin-top: 4px; }
`;
