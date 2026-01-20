/**
 * Gutter Decorations
 * 
 * Shows author initials or colored indicators in the editor gutter.
 * Less intrusive than full line highlighting.
 */

import * as vscode from 'vscode';
import { BlameParseResult } from '../blame/blameParser';
import { ExtensionSettings } from '../config/settings';
import { generateColor } from '../utils/colorGenerator';
import { getRelativeTime } from '../utils/timeParser';

/**
 * Gutter display mode
 */
export type GutterDisplayMode = 'initials' | 'dot' | 'age' | 'none';

/**
 * Gutter decoration data for a line
 */
interface GutterLineData {
    lineNumber: number;
    text: string;
    color: string;
    hoverText: string;
}

/**
 * Gutter decorator manager
 */
export class GutterDecorator {
    private decorations: Map<string, vscode.TextEditorDecorationType> = new Map();
    private currentSettings: ExtensionSettings;

    constructor(settings: ExtensionSettings) {
        this.currentSettings = settings;
    }

    /**
     * Update settings
     */
    updateSettings(settings: ExtensionSettings): void {
        this.currentSettings = settings;
        this.clearAll();
    }

    /**
     * Get author initials (up to 2 characters)
     */
    private getInitials(author: string): string {
        if (!author) return '??';
        
        const parts = author.trim().split(/\s+/);
        if (parts.length === 1) {
            return parts[0].substring(0, 2).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    /**
     * Get relative age indicator
     */
    private getAgeIndicator(timestamp: number): string {
        const now = Date.now() / 1000;
        const age = now - timestamp;
        
        const days = age / (24 * 60 * 60);
        
        if (days < 1) return '•';      // Today
        if (days < 7) return '◦';      // This week
        if (days < 30) return '○';     // This month
        if (days < 90) return '◌';     // This quarter
        return '○';                     // Older
    }

    /**
     * Apply gutter decorations for author mode
     */
    applyAuthorGutter(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        mode: GutterDisplayMode = 'initials'
    ): void {
        this.clearFromEditor(editor);

        if (mode === 'none') return;

        // Group lines by author for consistent colors
        const authorData = new Map<string, GutterLineData[]>();

        blameResult.lines.forEach((info, lineNumber) => {
            if (info.isUncommitted) return;

            const author = info.author;
            let text: string;

            switch (mode) {
                case 'initials':
                    text = this.getInitials(author);
                    break;
                case 'dot':
                    text = '●';
                    break;
                case 'age':
                    text = this.getAgeIndicator(info.authorTime);
                    break;
                default:
                    text = this.getInitials(author);
            }

            const data: GutterLineData = {
                lineNumber,
                text,
                color: generateColor(
                    author,
                    this.currentSettings.colorSaturation,
                    this.currentSettings.colorLightness + 15, // Slightly brighter for gutter
                    1.0 // Full opacity for gutter text
                ),
                hoverText: `${author} • ${getRelativeTime(info.authorTime)}`,
            };

            if (!authorData.has(author)) {
                authorData.set(author, []);
            }
            authorData.get(author)!.push(data);
        });

        // Create decorations for each author
        authorData.forEach((lines, author) => {
            if (lines.length === 0) return;

            const color = lines[0].color;
            const decorationType = this.getOrCreateDecoration(
                `gutter:${author}`,
                lines[0].text,
                color
            );

            const ranges = lines.map(data => {
                const range = new vscode.Range(
                    data.lineNumber - 1, 0,
                    data.lineNumber - 1, 0
                );
                const hoverMessage = new vscode.MarkdownString(data.hoverText);
                return { range, hoverMessage };
            });

            editor.setDecorations(decorationType, ranges);
        });
    }

    /**
     * Apply gutter decorations for heatmap mode
     */
    applyHeatmapGutter(
        editor: vscode.TextEditor,
        blameResult: BlameParseResult,
        colorMap: Map<number, string>  // lineNumber -> color
    ): void {
        this.clearFromEditor(editor);

        // Group by color for efficiency
        const colorGroups = new Map<string, number[]>();

        colorMap.forEach((color, lineNumber) => {
            if (!colorGroups.has(color)) {
                colorGroups.set(color, []);
            }
            colorGroups.get(color)!.push(lineNumber);
        });

        let colorIndex = 0;
        colorGroups.forEach((lines, color) => {
            const decorationType = this.getOrCreateDecoration(
                `heatmap:${colorIndex}`,
                '█',  // Solid block for heatmap
                color
            );

            const ranges = lines.map(lineNumber => {
                const info = blameResult.lines.get(lineNumber);
                const range = new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0);
                const hoverMessage = info 
                    ? new vscode.MarkdownString(`${info.author} • ${getRelativeTime(info.authorTime)}`)
                    : undefined;
                return { range, hoverMessage };
            });

            editor.setDecorations(decorationType, ranges);
            colorIndex++;
        });
    }

    /**
     * Get or create a decoration type for gutter
     */
    private getOrCreateDecoration(
        key: string,
        text: string,
        color: string
    ): vscode.TextEditorDecorationType {
        const existing = this.decorations.get(key);
        if (existing) {
            return existing;
        }

        // Extract RGB from rgba for better gutter visibility
        const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const gutterColor = rgbMatch 
            ? `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})`
            : color;

        const decoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: undefined,
            gutterIconSize: 'contain',
            before: {
                contentText: text,
                color: gutterColor,
                margin: '0 8px 0 0',
                width: '20px',
                fontWeight: 'bold',
                textDecoration: 'none; font-size: 10px; font-family: monospace;',
            },
        });

        this.decorations.set(key, decoration);
        return decoration;
    }

    /**
     * Clear all decorations from an editor
     */
    clearFromEditor(editor: vscode.TextEditor): void {
        this.decorations.forEach(decoration => {
            editor.setDecorations(decoration, []);
        });
    }

    /**
     * Clear all decorations and dispose
     */
    clearAll(): void {
        this.decorations.forEach(decoration => decoration.dispose());
        this.decorations.clear();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.clearAll();
    }
}

/**
 * Create a new gutter decorator instance
 */
export function createGutterDecorator(settings: ExtensionSettings): GutterDecorator {
    return new GutterDecorator(settings);
}
