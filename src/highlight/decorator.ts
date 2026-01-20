/**
 * Decorator
 * 
 * Manages VS Code editor decorations for line highlighting.
 * Supports multiple highlight modes: by age, author, commit, heatmap, or specific selection.
 */

import * as vscode from 'vscode';
import { BlameLineInfo, BlameParseResult } from '../blame/blameParser';
import { getCommitUrl } from '../blame/gitRunner';
import { formatTimestamp, getRelativeTime } from '../utils/timeParser';
import { ExtensionSettings } from '../config/settings';
import { generateColor } from '../utils/colorGenerator';
import { calculateHeatmap, groupHeatmapByColor, HeatmapConfig, getAgeBracket } from './heatmap';

/**
 * Highlight mode types
 */
export type HighlightMode = 
    | 'none'
    | 'age'
    | 'author'
    | 'commit'
    | 'heatmap'
    | 'specificAuthor'
    | 'specificCommit';

/**
 * Decoration range with hover content
 */
interface DecorationRangeWithHover {
    range: vscode.Range;
    hoverMessage: vscode.MarkdownString;
}

/**
 * Multi-mode line decorator manager
 */
export class LineDecorator {
    private currentSettings: ExtensionSettings;
    
    /** Static decoration for uncommitted lines */
    private uncommittedDecoration: vscode.TextEditorDecorationType;
    
    /** Static decoration for age-based highlighting */
    private ageDecoration: vscode.TextEditorDecorationType;
    
    /** Static decoration for selected/specific highlighting */
    private selectedDecoration: vscode.TextEditorDecorationType;

    /** Static decoration for code review mode (changes since branch) */
    private reviewDecoration: vscode.TextEditorDecorationType;
    
    /** Dynamic decorations for author/commit/heatmap colors */
    private dynamicDecorations: Map<string, vscode.TextEditorDecorationType> = new Map();

    /** Track highlighted line numbers for navigation (sorted) */
    private highlightedLines: number[] = [];

    /** Remote URL for creating commit links */
    private remoteUrl: string | undefined;

    constructor(settings: ExtensionSettings) {
        this.currentSettings = settings;
        this.uncommittedDecoration = this.createUncommittedDecoration();
        this.ageDecoration = this.createAgeDecoration();
        this.selectedDecoration = this.createSelectedDecoration();
        this.reviewDecoration = this.createReviewDecoration();
    }

    /**
     * Create decoration for uncommitted lines
     */
    private createUncommittedDecoration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: this.currentSettings.uncommittedHighlightColor,
            textDecoration: `underline wavy ${this.currentSettings.uncommittedUnderlineColor}`,
            overviewRulerColor: this.currentSettings.uncommittedUnderlineColor,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }

    /**
     * Create decoration for age-based highlighting
     */
    private createAgeDecoration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: this.currentSettings.ageHighlightColor,
            overviewRulerColor: this.currentSettings.ageHighlightColor,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }

    /**
     * Create decoration for selected author/commit highlighting
     */
    private createSelectedDecoration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: this.currentSettings.selectedHighlightColor,
            overviewRulerColor: this.currentSettings.selectedHighlightColor,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }

    /**
     * Create decoration for code review mode
     */
    private createReviewDecoration(): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: 'rgba(80, 200, 120, 0.25)',  // Green tint for changes
            overviewRulerColor: 'rgba(80, 200, 120, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Full,  // Full lane for better visibility
            // Add left border for better visibility
            borderWidth: '0 0 0 3px',
            borderStyle: 'solid',
            borderColor: 'rgba(80, 200, 120, 0.7)',
        });
    }

    /**
     * Create or get a dynamic decoration for a specific color
     * Enhanced with overview ruler visibility
     */
    private getDynamicDecoration(key: string, color: string, enhancedRuler: boolean = false): vscode.TextEditorDecorationType {
        const existing = this.dynamicDecorations.get(key);
        if (existing) {
            return existing;
        }

        // Extract RGB and create fully opaque version for overview ruler
        const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        let rulerColor = color;
        if (rgbMatch) {
            const r = rgbMatch[1], g = rgbMatch[2], b = rgbMatch[3];
            // Always use full opacity for overview ruler for better visibility
            rulerColor = `rgb(${r}, ${g}, ${b})`;
        }

        const decoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: color,
            overviewRulerColor: rulerColor,
            overviewRulerLane: enhancedRuler 
                ? vscode.OverviewRulerLane.Full  // Full width for heatmap
                : vscode.OverviewRulerLane.Center,
        });

        this.dynamicDecorations.set(key, decoration);
        return decoration;
    }

    /**
     * Clear all dynamic decorations
     */
    private clearDynamicDecorations(): void {
        this.dynamicDecorations.forEach(decoration => decoration.dispose());
        this.dynamicDecorations.clear();
    }

    /**
     * Update settings and recreate decorations
     */
    updateSettings(settings: ExtensionSettings): void {
        this.currentSettings = settings;
        
        // Dispose and recreate static decorations
        this.uncommittedDecoration.dispose();
        this.ageDecoration.dispose();
        this.selectedDecoration.dispose();
        this.reviewDecoration.dispose();
        
        this.uncommittedDecoration = this.createUncommittedDecoration();
        this.ageDecoration = this.createAgeDecoration();
        this.selectedDecoration = this.createSelectedDecoration();
        this.reviewDecoration = this.createReviewDecoration();
        
        // Clear dynamic decorations (will be recreated on next apply)
        this.clearDynamicDecorations();
    }

    /**
     * Set the remote URL for creating commit links
     */
    setRemoteUrl(url: string | undefined): void {
        this.remoteUrl = url;
    }

    /**
     * Apply age-based highlighting
     */
    applyAgeHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        recentLines: number[],
        uncommittedLines: number[]
    ): void {
        this.clearAllFromEditor(editor);

        // Track all highlighted lines for navigation
        const allHighlightedLines = [...recentLines];
        if (this.currentSettings.enableUncommittedHighlight) {
            allHighlightedLines.push(...uncommittedLines);
        }
        this.highlightedLines = [...new Set(allHighlightedLines)].sort((a, b) => a - b);

        const recentDecorations = this.createDecorationRanges(
            editor.document,
            recentLines,
            blameResult
        );

        editor.setDecorations(this.ageDecoration, recentDecorations);

        if (this.currentSettings.enableUncommittedHighlight) {
            const uncommittedDecorations = this.createDecorationRanges(
                editor.document,
                uncommittedLines,
                blameResult,
                true
            );
            editor.setDecorations(this.uncommittedDecoration, uncommittedDecorations);
        }
    }

    /**
     * Apply author-based highlighting (each author gets a unique color)
     */
    applyAuthorHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        uncommittedLines: number[]
    ): void {
        this.clearAllFromEditor(editor);
        this.clearDynamicDecorations();

        // Group lines by author and track all highlighted lines
        const authorLines = new Map<string, number[]>();
        const allHighlightedLines: number[] = [];
        
        blameResult.lines.forEach((info, lineNum) => {
            if (!info.isUncommitted) {
                const lines = authorLines.get(info.author) || [];
                lines.push(lineNum);
                authorLines.set(info.author, lines);
                allHighlightedLines.push(lineNum);
            }
        });

        if (this.currentSettings.enableUncommittedHighlight) {
            allHighlightedLines.push(...uncommittedLines);
        }
        this.highlightedLines = [...new Set(allHighlightedLines)].sort((a, b) => a - b);

        // Apply decorations for each author
        authorLines.forEach((lines, author) => {
            const color = generateColor(
                author,
                this.currentSettings.colorSaturation,
                this.currentSettings.colorLightness,
                this.currentSettings.colorOpacity
            );
            const decoration = this.getDynamicDecoration(`author:${author}`, color);
            const ranges = this.createDecorationRanges(editor.document, lines, blameResult);
            editor.setDecorations(decoration, ranges);
        });

        // Handle uncommitted lines
        if (this.currentSettings.enableUncommittedHighlight && uncommittedLines.length > 0) {
            const uncommittedDecorations = this.createDecorationRanges(
                editor.document,
                uncommittedLines,
                blameResult,
                true
            );
            editor.setDecorations(this.uncommittedDecoration, uncommittedDecorations);
        }
    }

    /**
     * Apply commit-based highlighting (each commit gets a unique color)
     */
    applyCommitHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        uncommittedLines: number[]
    ): void {
        this.clearAllFromEditor(editor);
        this.clearDynamicDecorations();

        // Group lines by commit and track all highlighted lines
        const commitLines = new Map<string, number[]>();
        const allHighlightedLines: number[] = [];
        
        blameResult.lines.forEach((info, lineNum) => {
            if (!info.isUncommitted) {
                const lines = commitLines.get(info.commitSha) || [];
                lines.push(lineNum);
                commitLines.set(info.commitSha, lines);
                allHighlightedLines.push(lineNum);
            }
        });

        if (this.currentSettings.enableUncommittedHighlight) {
            allHighlightedLines.push(...uncommittedLines);
        }
        this.highlightedLines = [...new Set(allHighlightedLines)].sort((a, b) => a - b);

        // Apply decorations for each commit
        commitLines.forEach((lines, commitSha) => {
            const color = generateColor(
                commitSha,
                this.currentSettings.colorSaturation,
                this.currentSettings.colorLightness,
                this.currentSettings.colorOpacity
            );
            const decoration = this.getDynamicDecoration(`commit:${commitSha}`, color);
            const ranges = this.createDecorationRanges(editor.document, lines, blameResult);
            editor.setDecorations(decoration, ranges);
        });

        // Handle uncommitted lines
        if (this.currentSettings.enableUncommittedHighlight && uncommittedLines.length > 0) {
            const uncommittedDecorations = this.createDecorationRanges(
                editor.document,
                uncommittedLines,
                blameResult,
                true
            );
            editor.setDecorations(this.uncommittedDecoration, uncommittedDecorations);
        }
    }

    /**
     * Apply highlighting for a specific author
     */
    applySpecificAuthorHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        authorName: string
    ): void {
        this.clearAllFromEditor(editor);

        const matchingLines: number[] = [];
        blameResult.lines.forEach((info, lineNum) => {
            if (info.author.toLowerCase() === authorName.toLowerCase()) {
                matchingLines.push(lineNum);
            }
        });

        // Track highlighted lines for navigation
        this.highlightedLines = matchingLines.sort((a, b) => a - b);

        const decorations = this.createDecorationRanges(
            editor.document,
            matchingLines,
            blameResult
        );

        editor.setDecorations(this.selectedDecoration, decorations);
    }

    /**
     * Apply highlighting for a specific commit
     */
    applySpecificCommitHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        commitSha: string
    ): void {
        this.clearAllFromEditor(editor);

        const matchingLines: number[] = [];
        blameResult.lines.forEach((info, lineNum) => {
            if (info.commitSha.startsWith(commitSha)) {
                matchingLines.push(lineNum);
            }
        });

        // Track highlighted lines for navigation
        this.highlightedLines = matchingLines.sort((a, b) => a - b);

        const decorations = this.createDecorationRanges(
            editor.document,
            matchingLines,
            blameResult
        );

        editor.setDecorations(this.selectedDecoration, decorations);
    }

    /**
     * Apply heatmap highlighting (gradient colors based on age)
     */
    applyHeatmapHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        uncommittedLines: number[]
    ): void {
        this.clearAllFromEditor(editor);
        this.clearDynamicDecorations();

        // Calculate heatmap with custom config from settings
        const config: HeatmapConfig = {
            coldHue: 240,  // Blue for oldest
            hotHue: 160,   // Teal for newest
            saturation: this.currentSettings.colorSaturation,
            lightness: this.currentSettings.colorLightness,
            opacity: this.currentSettings.colorOpacity,
        };

        const heatmapGroups = groupHeatmapByColor(
            calculateHeatmap(blameResult, config),
            20, // 20 color buckets
            config
        );

        const allHighlightedLines: number[] = [];

        // Apply decorations for each color group
        heatmapGroups.forEach((group, bucketIndex) => {
            const decoration = this.getDynamicDecoration(
                `heatmap:${bucketIndex}`,
                group.color,
                true // Enhanced minimap visibility
            );

            const ranges = this.createDecorationRangesForHeatmap(
                editor.document,
                group.lines,
                blameResult,
                bucketIndex / 20 // age ratio for hover
            );

            editor.setDecorations(decoration, ranges);
            allHighlightedLines.push(...group.lines);
        });

        // Handle uncommitted lines
        if (this.currentSettings.enableUncommittedHighlight) {
            allHighlightedLines.push(...uncommittedLines);
            if (uncommittedLines.length > 0) {
                const uncommittedDecorations = this.createDecorationRanges(
                    editor.document,
                    uncommittedLines,
                    blameResult,
                    true
                );
                editor.setDecorations(this.uncommittedDecoration, uncommittedDecorations);
            }
        }

        this.highlightedLines = [...new Set(allHighlightedLines)].sort((a, b) => a - b);
    }

    /**
     * Apply code review highlighting (changes since a specific commit/branch)
     * @param reviewCommits - Set of commit SHAs that are part of the review (changes since base branch)
     */
    applyReviewHighlighting(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        reviewCommits: Set<string>
    ): void {
        this.clearAllFromEditor(editor);

        const changedLines: number[] = [];

        // Find all lines that belong to commits in the review set
        blameResult.lines.forEach((info, lineNum) => {
            if (!info.isUncommitted && reviewCommits.has(info.commitSha)) {
                changedLines.push(lineNum);
            }
        });

        // Also include uncommitted lines as they are changes
        const uncommittedLines: number[] = [];
        blameResult.lines.forEach((info, lineNum) => {
            if (info.isUncommitted) {
                uncommittedLines.push(lineNum);
            }
        });

        this.highlightedLines = [...changedLines, ...uncommittedLines].sort((a, b) => a - b);

        const decorations = this.createDecorationRanges(
            editor.document,
            changedLines,
            blameResult
        );
        editor.setDecorations(this.reviewDecoration, decorations);

        if (this.currentSettings.enableUncommittedHighlight && uncommittedLines.length > 0) {
            const uncommittedDecorations = this.createDecorationRanges(
                editor.document,
                uncommittedLines,
                blameResult,
                true
            );
            editor.setDecorations(this.uncommittedDecoration, uncommittedDecorations);
        }
    }

    /**
     * Create decoration ranges for heatmap with age-specific hover
     */
    private createDecorationRangesForHeatmap(
        document: vscode.TextDocument,
        lineNumbers: number[],
        blameResult: BlameParseResult,
        ageRatio: number
    ): DecorationRangeWithHover[] {
        const decorations: DecorationRangeWithHover[] = [];
        const documentLineCount = document.lineCount;
        const ageBracket = getAgeBracket(ageRatio);

        for (const lineNum of lineNumbers) {
            const zeroBasedLine = lineNum - 1;
            
            if (zeroBasedLine < 0 || zeroBasedLine >= documentLineCount) {
                continue;
            }

            const lineInfo = blameResult.lines.get(lineNum);
            if (!lineInfo) {
                continue;
            }

            const line = document.lineAt(zeroBasedLine);
            const hoverMessage = this.createHeatmapHoverMessage(lineInfo, ageBracket);

            decorations.push({ range: line.range, hoverMessage });
        }

        return decorations;
    }

    /**
     * Create hover message for heatmap mode
     */
    private createHeatmapHoverMessage(
        lineInfo: BlameLineInfo,
        ageBracket: string
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        md.appendMarkdown('### 🌡️ Age Heatmap\n\n');
        md.appendMarkdown(`**Age:** ${ageBracket}\n\n`);
        md.appendMarkdown(`**Author:** ${this.escapeMarkdown(lineInfo.author)}\n\n`);
        md.appendMarkdown(`**Date:** ${formatTimestamp(lineInfo.authorTime)} (${getRelativeTime(lineInfo.authorTime)})\n\n`);
        
        // Create commit link if remote URL is available
        const commitUrl = this.remoteUrl ? getCommitUrl(this.remoteUrl, lineInfo.commitSha) : undefined;
        if (commitUrl) {
            md.appendMarkdown(`**Commit:** [${lineInfo.commitSha.substring(0, 8)}](${commitUrl})\n`);
        } else {
            md.appendMarkdown(`**Commit:** \`${lineInfo.commitSha.substring(0, 8)}\`\n`);
        }

        return md;
    }

    /**
     * Clear all decorations from an editor
     */
    clearAllFromEditor(editor: vscode.TextEditor): void {
        editor.setDecorations(this.ageDecoration, []);
        editor.setDecorations(this.uncommittedDecoration, []);
        editor.setDecorations(this.selectedDecoration, []);
        editor.setDecorations(this.reviewDecoration, []);
        
        this.dynamicDecorations.forEach(decoration => {
            editor.setDecorations(decoration, []);
        });
    }

    /**
     * Clear decorations from all visible editors
     */
    clearAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.clearAllFromEditor(editor);
        }
        this.clearDynamicDecorations();
        this.highlightedLines = [];
    }

    /**
     * Get the highlighted lines (1-indexed, sorted)
     */
    getHighlightedLines(): number[] {
        return this.highlightedLines;
    }

    /**
     * Navigate to the next highlighted line from current cursor position
     * @returns The line number navigated to, or undefined if no next highlight
     */
    goToNextHighlight(editor: vscode.TextEditor): number | undefined {
        if (this.highlightedLines.length === 0) {
            return undefined;
        }

        const currentLine = editor.selection.active.line + 1; // Convert to 1-indexed
        
        // Find the first highlighted line after current position
        const nextLine = this.highlightedLines.find(line => line > currentLine);
        
        // If no line after current, wrap to the first highlighted line
        const targetLine = nextLine ?? this.highlightedLines[0];
        
        this.revealLine(editor, targetLine);
        return targetLine;
    }

    /**
     * Navigate to the previous highlighted line from current cursor position
     * @returns The line number navigated to, or undefined if no previous highlight
     */
    goToPreviousHighlight(editor: vscode.TextEditor): number | undefined {
        if (this.highlightedLines.length === 0) {
            return undefined;
        }

        const currentLine = editor.selection.active.line + 1; // Convert to 1-indexed
        
        // Find the last highlighted line before current position
        const previousLines = this.highlightedLines.filter(line => line < currentLine);
        const previousLine = previousLines.length > 0 ? previousLines[previousLines.length - 1] : undefined;
        
        // If no line before current, wrap to the last highlighted line
        const targetLine = previousLine ?? this.highlightedLines[this.highlightedLines.length - 1];
        
        this.revealLine(editor, targetLine);
        return targetLine;
    }

    /**
     * Reveal and move cursor to a specific line
     */
    private revealLine(editor: vscode.TextEditor, lineNumber: number): void {
        const zeroBasedLine = lineNumber - 1;
        const position = new vscode.Position(zeroBasedLine, 0);
        const selection = new vscode.Selection(position, position);
        
        editor.selection = selection;
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    }

    /**
     * Create decoration ranges with hover information
     */
    private createDecorationRanges(
        document: vscode.TextDocument,
        lineNumbers: number[],
        blameResult: BlameParseResult,
        isUncommitted: boolean = false
    ): DecorationRangeWithHover[] {
        const decorations: DecorationRangeWithHover[] = [];
        const documentLineCount = document.lineCount;

        for (const lineNum of lineNumbers) {
            const zeroBasedLine = lineNum - 1;
            
            if (zeroBasedLine < 0 || zeroBasedLine >= documentLineCount) {
                continue;
            }

            const lineInfo = blameResult.lines.get(lineNum);
            if (!lineInfo) {
                continue;
            }

            const line = document.lineAt(zeroBasedLine);
            const hoverMessage = this.createHoverMessage(lineInfo, isUncommitted);

            decorations.push({ range: line.range, hoverMessage });
        }

        return decorations;
    }

    /**
     * Create hover message for a line
     */
    private createHoverMessage(
        lineInfo: BlameLineInfo,
        isUncommitted: boolean
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        if (isUncommitted) {
            md.appendMarkdown('### 📝 Uncommitted Change\n\n');
            md.appendMarkdown('This line has been modified but not committed yet.\n');
        } else {
            md.appendMarkdown('### 🔍 Git Spotlight\n\n');
            md.appendMarkdown(`**Author:** ${this.escapeMarkdown(lineInfo.author)}\n\n`);
            md.appendMarkdown(`**Date:** ${formatTimestamp(lineInfo.authorTime)} (${getRelativeTime(lineInfo.authorTime)})\n\n`);
            
            // Create commit link if remote URL is available
            const commitUrl = this.remoteUrl ? getCommitUrl(this.remoteUrl, lineInfo.commitSha) : undefined;
            if (commitUrl) {
                md.appendMarkdown(`**Commit:** [${lineInfo.commitSha.substring(0, 8)}](${commitUrl})\n\n`);
            } else {
                md.appendMarkdown(`**Commit:** \`${lineInfo.commitSha.substring(0, 8)}\`\n\n`);
            }
            
            if (lineInfo.summary) {
                md.appendMarkdown(`**Message:** ${this.escapeMarkdown(lineInfo.summary)}\n`);
            }
        }

        return md;
    }

    /**
     * Escape special markdown characters
     */
    private escapeMarkdown(text: string): string {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/\*/g, '\\*')
            .replace(/_/g, '\\_')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Get all unique authors from blame result
     */
    static getAuthors(blameResult: BlameParseResult): string[] {
        const authors = new Set<string>();
        blameResult.lines.forEach(info => {
            if (!info.isUncommitted) {
                authors.add(info.author);
            }
        });
        return Array.from(authors).sort();
    }

    /**
     * Get all unique commits from blame result
     */
    static getCommits(blameResult: BlameParseResult): Array<{ sha: string; summary: string; author: string }> {
        const commits = new Map<string, { sha: string; summary: string; author: string }>();
        blameResult.lines.forEach(info => {
            if (!info.isUncommitted && !commits.has(info.commitSha)) {
                commits.set(info.commitSha, {
                    sha: info.commitSha,
                    summary: info.summary,
                    author: info.author,
                });
            }
        });
        return Array.from(commits.values());
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.uncommittedDecoration.dispose();
        this.ageDecoration.dispose();
        this.selectedDecoration.dispose();
        this.reviewDecoration.dispose();
        this.clearDynamicDecorations();
    }
}

/**
 * Create a new line decorator instance
 */
export function createLineDecorator(settings: ExtensionSettings): LineDecorator {
    return new LineDecorator(settings);
}
