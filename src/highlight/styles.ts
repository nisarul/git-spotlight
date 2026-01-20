/**
 * Highlight Styles
 * 
 * Defines the visual decoration styles for highlighted lines.
 * Provides factory functions to create VS Code decoration types
 * based on user configuration.
 */

import * as vscode from 'vscode';
import { ExtensionSettings } from '../config/settings';

/**
 * Collection of decoration types used by the extension
 */
export interface DecorationStyles {
    /** Decoration for recently modified lines */
    recentModification: vscode.TextEditorDecorationType;
    /** Decoration for uncommitted lines */
    uncommitted: vscode.TextEditorDecorationType;
}

/**
 * Create decoration type for recently modified lines
 * 
 * @param settings - Extension settings
 * @returns TextEditorDecorationType for recent modifications
 */
export function createRecentModificationDecoration(
    settings: ExtensionSettings
): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: settings.ageHighlightColor,
        overviewRulerColor: settings.ageHighlightColor,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
}

/**
 * Create decoration type for uncommitted lines
 * 
 * @param settings - Extension settings
 * @returns TextEditorDecorationType for uncommitted changes
 */
export function createUncommittedDecoration(
    settings: ExtensionSettings
): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: settings.uncommittedHighlightColor,
        // Red underline for uncommitted lines
        textDecoration: `underline wavy ${settings.uncommittedUnderlineColor}`,
        overviewRulerColor: settings.uncommittedUnderlineColor,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
}

/**
 * Create all decoration styles based on current settings
 * 
 * @param settings - Extension settings
 * @returns Collection of decoration types
 */
export function createDecorationStyles(settings: ExtensionSettings): DecorationStyles {
    return {
        recentModification: createRecentModificationDecoration(settings),
        uncommitted: createUncommittedDecoration(settings),
    };
}

/**
 * Dispose all decoration types in a styles collection
 * 
 * @param styles - Decoration styles to dispose
 */
export function disposeDecorationStyles(styles: DecorationStyles): void {
    styles.recentModification.dispose();
    styles.uncommitted.dispose();
}

/**
 * Parse a color string and validate it
 * Accepts: rgba(), rgb(), hex, named colors
 * 
 * @param color - Color string to validate
 * @returns true if color appears valid
 */
export function isValidColor(color: string): boolean {
    // Basic validation for common color formats
    const trimmed = color.trim().toLowerCase();
    
    // rgba(r, g, b, a)
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(trimmed)) {
        return true;
    }
    
    // Hex colors
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(trimmed)) {
        return true;
    }
    
    // Named colors (basic check)
    const namedColors = [
        'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink',
        'white', 'black', 'gray', 'grey', 'transparent'
    ];
    if (namedColors.includes(trimmed)) {
        return true;
    }
    
    return false;
}

/**
 * Adjust color opacity
 * 
 * @param color - Color in rgba format
 * @param opacity - New opacity (0-1)
 * @returns Adjusted color string
 */
export function adjustOpacity(color: string, opacity: number): string {
    // Extract rgba components
    const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/);
    if (match) {
        const [, r, g, b] = match;
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    
    // If not rgba, try hex conversion
    const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
        const hex = hexMatch[1];
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    
    // Return original if can't parse
    return color;
}
