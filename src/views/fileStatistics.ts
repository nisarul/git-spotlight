/**
 * File Statistics Provider
 * 
 * Provides statistics about the current file's Git history
 * for display in a sidebar webview panel.
 */

import * as vscode from 'vscode';
import { BlameParseResult } from '../blame/blameParser';
import { getCommitUrl } from '../blame/gitRunner';
import { getRelativeTime } from '../utils/timeParser';

/**
 * Statistics about a single author
 */
export interface AuthorStats {
    name: string;
    lineCount: number;
    percentage: number;
    firstCommit: number;  // timestamp
    lastCommit: number;   // timestamp
    commitCount: number;
}

/**
 * Statistics about a commit
 */
export interface CommitStats {
    sha: string;
    shortSha: string;
    author: string;
    timestamp: number;
    summary: string;
    lineCount: number;
}

/**
 * Activity data for timeline
 */
export interface ActivityData {
    date: string;      // YYYY-MM-DD
    commits: number;
    lines: number;
}

/**
 * Complete file statistics
 */
export interface FileStatistics {
    /** File path */
    filePath: string;
    /** Remote URL for commit links */
    remoteUrl?: string;
    /** Total number of lines */
    totalLines: number;
    /** Number of uncommitted lines */
    uncommittedLines: number;
    /** Statistics per author */
    authors: AuthorStats[];
    /** Recent commits affecting this file */
    recentCommits: CommitStats[];
    /** Activity timeline (last 30 days) */
    activityTimeline: ActivityData[];
    /** Age statistics */
    ageStats: {
        oldestCommit: number;
        newestCommit: number;
        averageAge: number;  // days
    };
}

/**
 * Calculate file statistics from blame result
 */
export function calculateFileStatistics(
    filePath: string,
    blameResult: BlameParseResult,
    remoteUrl?: string
): FileStatistics {
    const authorMap = new Map<string, {
        lines: number;
        commits: Set<string>;
        firstCommit: number;
        lastCommit: number;
    }>();

    const commitMap = new Map<string, CommitStats>();
    const activityMap = new Map<string, { commits: Set<string>; lines: number }>();

    let uncommittedCount = 0;
    let oldestCommit = Infinity;
    let newestCommit = -Infinity;
    let totalAge = 0;
    let committedLineCount = 0;

    const now = Date.now() / 1000;
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60);

    blameResult.lines.forEach((info, _lineNumber) => {
        if (info.isUncommitted) {
            uncommittedCount++;
            return;
        }

        committedLineCount++;

        // Update author stats
        if (!authorMap.has(info.author)) {
            authorMap.set(info.author, {
                lines: 0,
                commits: new Set(),
                firstCommit: Infinity,
                lastCommit: -Infinity,
            });
        }
        const authorStats = authorMap.get(info.author)!;
        authorStats.lines++;
        authorStats.commits.add(info.commitSha);
        authorStats.firstCommit = Math.min(authorStats.firstCommit, info.authorTime);
        authorStats.lastCommit = Math.max(authorStats.lastCommit, info.authorTime);

        // Update commit stats
        if (!commitMap.has(info.commitSha)) {
            commitMap.set(info.commitSha, {
                sha: info.commitSha,
                shortSha: info.commitSha.substring(0, 8),
                author: info.author,
                timestamp: info.authorTime,
                summary: info.summary,
                lineCount: 0,
            });
        }
        commitMap.get(info.commitSha)!.lineCount++;

        // Update age stats
        oldestCommit = Math.min(oldestCommit, info.authorTime);
        newestCommit = Math.max(newestCommit, info.authorTime);
        totalAge += (now - info.authorTime) / (24 * 60 * 60); // days

        // Update activity timeline (last 30 days)
        if (info.authorTime >= thirtyDaysAgo) {
            const date = new Date(info.authorTime * 1000).toISOString().split('T')[0];
            if (!activityMap.has(date)) {
                activityMap.set(date, { commits: new Set(), lines: 0 });
            }
            const activity = activityMap.get(date)!;
            activity.commits.add(info.commitSha);
            activity.lines++;
        }
    });

    // Convert author map to sorted array
    const totalLines = blameResult.lineCount;
    const authors: AuthorStats[] = Array.from(authorMap.entries())
        .map(([name, stats]) => ({
            name,
            lineCount: stats.lines,
            percentage: totalLines > 0 ? (stats.lines / totalLines) * 100 : 0,
            firstCommit: stats.firstCommit,
            lastCommit: stats.lastCommit,
            commitCount: stats.commits.size,
        }))
        .sort((a, b) => b.lineCount - a.lineCount);

    // Get recent commits (sorted by timestamp, newest first)
    const recentCommits = Array.from(commitMap.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

    // Build activity timeline
    const activityTimeline: ActivityData[] = Array.from(activityMap.entries())
        .map(([date, data]) => ({
            date,
            commits: data.commits.size,
            lines: data.lines,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        filePath,
        remoteUrl,
        totalLines,
        uncommittedLines: uncommittedCount,
        authors,
        recentCommits,
        activityTimeline,
        ageStats: {
            oldestCommit: oldestCommit === Infinity ? 0 : oldestCommit,
            newestCommit: newestCommit === -Infinity ? 0 : newestCommit,
            averageAge: committedLineCount > 0 ? totalAge / committedLineCount : 0,
        },
    };
}

/**
 * File Statistics Panel
 * 
 * Webview panel showing file statistics
 */
export class FileStatisticsPanel {
    public static currentPanel: FileStatisticsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
        this._panel = panel;
        // _extensionUri stored for potential future use with webview resources

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /**
     * Create or show the panel
     */
    public static createOrShow(extensionUri: vscode.Uri): FileStatisticsPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (FileStatisticsPanel.currentPanel) {
            FileStatisticsPanel.currentPanel._panel.reveal(column);
            return FileStatisticsPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'gitSpotlightStats',
            'Git Spotlight Statistics',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        FileStatisticsPanel.currentPanel = new FileStatisticsPanel(panel, extensionUri);
        return FileStatisticsPanel.currentPanel;
    }

    /**
     * Update the panel with new statistics
     */
    public update(stats: FileStatistics): void {
        this._panel.webview.html = this._getHtmlContent(stats);
    }

    /**
     * Generate HTML content for the webview
     */
    private _getHtmlContent(stats: FileStatistics): string {
        const fileName = stats.filePath.split('/').pop() || stats.filePath;

        // Generate author rows
        const authorRows = stats.authors
            .slice(0, 10)
            .map(author => `
                <tr>
                    <td class="author-name">${this._escapeHtml(author.name)}</td>
                    <td class="lines">${author.lineCount}</td>
                    <td class="percentage">
                        <div class="bar-container">
                            <div class="bar" style="width: ${author.percentage}%"></div>
                            <span>${author.percentage.toFixed(1)}%</span>
                        </div>
                    </td>
                    <td class="commits">${author.commitCount}</td>
                </tr>
            `)
            .join('');

        // Generate commit rows with optional hyperlinks
        const commitRows = stats.recentCommits
            .map(commit => {
                const commitUrl = stats.remoteUrl ? getCommitUrl(stats.remoteUrl, commit.sha) : undefined;
                const shaCell = commitUrl 
                    ? `<a href="${commitUrl}" class="commit-link">${commit.shortSha}</a>`
                    : commit.shortSha;
                return `
                <tr>
                    <td class="sha">${shaCell}</td>
                    <td class="author">${this._escapeHtml(commit.author)}</td>
                    <td class="date">${getRelativeTime(commit.timestamp)}</td>
                    <td class="summary">${this._escapeHtml(commit.summary || '(no message)')}</td>
                </tr>
            `;
            })
            .join('');

        // Generate activity chart data
        const maxLines = Math.max(...stats.activityTimeline.map(d => d.lines), 1);
        const activityBars = stats.activityTimeline
            .map(day => {
                const height = (day.lines / maxLines) * 100;
                return `<div class="activity-bar" style="height: ${height}%" title="${day.date}: ${day.lines} lines, ${day.commits} commits"></div>`;
            })
            .join('');

        const avgAgeDays = Math.round(stats.ageStats.averageAge);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Spotlight Statistics</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --accent-color: var(--vscode-textLink-foreground);
            --highlight-bg: var(--vscode-list-hoverBackground);
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-color);
            background: var(--bg-color);
            padding: 16px;
            margin: 0;
        }
        h1, h2 {
            color: var(--accent-color);
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
        }
        h1 { font-size: 1.4em; margin-top: 0; }
        h2 { font-size: 1.1em; margin-top: 24px; }
        .file-name {
            color: var(--vscode-textPreformat-foreground);
            font-family: monospace;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 16px;
            margin: 16px 0;
        }
        .stat-card {
            background: var(--highlight-bg);
            padding: 12px;
            border-radius: 6px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            color: var(--accent-color);
        }
        .stat-label {
            font-size: 0.85em;
            opacity: 0.8;
            margin-top: 4px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }
        th {
            font-weight: 600;
            opacity: 0.8;
        }
        .bar-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .bar {
            height: 8px;
            background: var(--accent-color);
            border-radius: 4px;
            min-width: 2px;
        }
        .activity-chart {
            display: flex;
            align-items: flex-end;
            gap: 2px;
            height: 60px;
            margin: 12px 0;
            padding: 8px;
            background: var(--highlight-bg);
            border-radius: 6px;
        }
        .activity-bar {
            flex: 1;
            background: var(--accent-color);
            border-radius: 2px 2px 0 0;
            min-height: 2px;
            transition: opacity 0.2s;
        }
        .activity-bar:hover {
            opacity: 0.7;
        }
        .sha {
            font-family: monospace;
            color: var(--vscode-textPreformat-foreground);
        }
        .commit-link {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            font-family: monospace;
        }
        .commit-link:hover {
            text-decoration: underline;
        }
        .summary {
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .no-data {
            text-align: center;
            padding: 24px;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <h1>📊 Git Spotlight Statistics</h1>
    <p class="file-name">${this._escapeHtml(fileName)}</p>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">${stats.totalLines}</div>
            <div class="stat-label">Total Lines</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.authors.length}</div>
            <div class="stat-label">Contributors</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.recentCommits.length}</div>
            <div class="stat-label">Commits</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${avgAgeDays}d</div>
            <div class="stat-label">Avg Age</div>
        </div>
    </div>

    ${stats.uncommittedLines > 0 ? `
    <p>⚠️ <strong>${stats.uncommittedLines}</strong> uncommitted lines</p>
    ` : ''}

    <h2>👥 Top Contributors</h2>
    ${stats.authors.length > 0 ? `
    <table>
        <thead>
            <tr>
                <th>Author</th>
                <th>Lines</th>
                <th>Share</th>
                <th>Commits</th>
            </tr>
        </thead>
        <tbody>
            ${authorRows}
        </tbody>
    </table>
    ` : '<p class="no-data">No author data available</p>'}

    <h2>📅 Activity (Last 30 Days)</h2>
    ${stats.activityTimeline.length > 0 ? `
    <div class="activity-chart">
        ${activityBars}
    </div>
    ` : '<p class="no-data">No recent activity</p>'}

    <h2>🔄 Recent Commits</h2>
    ${stats.recentCommits.length > 0 ? `
    <table>
        <thead>
            <tr>
                <th>SHA</th>
                <th>Author</th>
                <th>When</th>
                <th>Message</th>
            </tr>
        </thead>
        <tbody>
            ${commitRows}
        </tbody>
    </table>
    ` : '<p class="no-data">No commit data available</p>'}

</body>
</html>`;
    }

    /**
     * Escape HTML special characters
     */
    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Dispose the panel
     */
    public dispose(): void {
        FileStatisticsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
