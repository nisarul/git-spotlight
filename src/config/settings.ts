/**
 * Git Spotlight - Configuration Settings
 * 
 * Centralized configuration management for the extension.
 * Reads from VS Code workspace configuration and provides type-safe access.
 */

import * as vscode from 'vscode';

/** Configuration keys used by the extension */
const CONFIG_SECTION = 'gitSpotlight';

/**
 * Type-safe settings interface
 */
export interface ExtensionSettings {
    /** Duration string for filtering recent changes (e.g., "7d", "30d", "3m") */
    duration: string;
    /** Whether to highlight uncommitted lines differently */
    enableUncommittedHighlight: boolean;
    /** Maximum file size in KB to process */
    maxFileSizeKB: number;
    /** Background color for age-based highlights */
    ageHighlightColor: string;
    /** Background color for uncommitted lines */
    uncommittedHighlightColor: string;
    /** Underline color for uncommitted lines */
    uncommittedUnderlineColor: string;
    /** Background color for specific author/commit selection */
    selectedHighlightColor: string;
    /** Git command timeout in milliseconds */
    gitTimeout: number;
    /** Debounce delay before running git blame */
    debounceDelay: number;
    /** Color saturation for generated colors (0-100) */
    colorSaturation: number;
    /** Color lightness for generated colors (0-100) */
    colorLightness: number;
    /** Color opacity for highlights (0-1) */
    colorOpacity: number;
    /** Whether to show gutter annotations */
    enableGutterAnnotations: boolean;
    /** Gutter display mode: initials, dot, or age */
    gutterDisplayMode: 'initials' | 'dot' | 'age';
    /** Whether to enhance minimap visibility */
    enhancedMinimapColors: boolean;
}

/**
 * Default settings used when configuration is not available
 */
const DEFAULT_SETTINGS: ExtensionSettings = {
    duration: '30d',
    enableUncommittedHighlight: true,
    maxFileSizeKB: 1024,
    ageHighlightColor: 'rgba(70,130,180,0.3)',
    uncommittedHighlightColor: 'rgba(180,80,80,0.25)',
    uncommittedUnderlineColor: 'rgba(180,80,80,0.6)',
    selectedHighlightColor: 'rgba(64,224,208,0.3)',
    gitTimeout: 5000,
    debounceDelay: 300,
    colorSaturation: 55,
    colorLightness: 45,
    colorOpacity: 0.28,
    enableGutterAnnotations: false,
    gutterDisplayMode: 'initials',
    enhancedMinimapColors: true,
};

/**
 * Get the current extension settings
 * @returns Current settings with defaults applied
 */
export function getSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
        duration: config.get<string>('duration', DEFAULT_SETTINGS.duration),
        enableUncommittedHighlight: config.get<boolean>(
            'enableUncommittedHighlight',
            DEFAULT_SETTINGS.enableUncommittedHighlight
        ),
        maxFileSizeKB: config.get<number>('maxFileSizeKB', DEFAULT_SETTINGS.maxFileSizeKB),
        ageHighlightColor: config.get<string>('ageHighlightColor', DEFAULT_SETTINGS.ageHighlightColor),
        uncommittedHighlightColor: config.get<string>(
            'uncommittedHighlightColor',
            DEFAULT_SETTINGS.uncommittedHighlightColor
        ),
        uncommittedUnderlineColor: config.get<string>(
            'uncommittedUnderlineColor',
            DEFAULT_SETTINGS.uncommittedUnderlineColor
        ),
        selectedHighlightColor: config.get<string>(
            'selectedHighlightColor',
            DEFAULT_SETTINGS.selectedHighlightColor
        ),
        gitTimeout: config.get<number>('gitTimeout', DEFAULT_SETTINGS.gitTimeout),
        debounceDelay: config.get<number>('debounceDelay', DEFAULT_SETTINGS.debounceDelay),
        colorSaturation: config.get<number>('colorSaturation', DEFAULT_SETTINGS.colorSaturation),
        colorLightness: config.get<number>('colorLightness', DEFAULT_SETTINGS.colorLightness),
        colorOpacity: config.get<number>('colorOpacity', DEFAULT_SETTINGS.colorOpacity),
        enableGutterAnnotations: config.get<boolean>('enableGutterAnnotations', DEFAULT_SETTINGS.enableGutterAnnotations),
        gutterDisplayMode: config.get<'initials' | 'dot' | 'age'>('gutterDisplayMode', DEFAULT_SETTINGS.gutterDisplayMode),
        enhancedMinimapColors: config.get<boolean>('enhancedMinimapColors', DEFAULT_SETTINGS.enhancedMinimapColors),
    };
}

/**
 * Create a configuration change listener
 * @param callback Function to call when settings change
 * @returns Disposable to unregister the listener
 */
export function onSettingsChanged(callback: (settings: ExtensionSettings) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
            callback(getSettings());
        }
    });
}
