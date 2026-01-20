/**
 * Heatmap Mode
 * 
 * Generates gradient colors based on code age.
 * Older code → cooler colors (blue/purple)
 * Newer code → warmer colors (green/teal)
 */

import { BlameParseResult } from '../blame/blameParser';

/**
 * Heatmap color configuration
 */
export interface HeatmapConfig {
    /** Oldest color (cold) - HSL hue 0-360 */
    coldHue: number;
    /** Newest color (hot) - HSL hue 0-360 */
    hotHue: number;
    /** Color saturation (0-100) */
    saturation: number;
    /** Color lightness (0-100) */
    lightness: number;
    /** Color opacity (0-1) */
    opacity: number;
}

/**
 * Default heatmap configuration
 * Blue (240°) → Cyan (180°) → Green (120°) gradient
 */
export const DEFAULT_HEATMAP_CONFIG: HeatmapConfig = {
    coldHue: 240,    // Blue for oldest
    hotHue: 160,     // Teal/Cyan for newest
    saturation: 55,
    lightness: 45,
    opacity: 0.30,
};

/**
 * Heatmap line data with computed color
 */
export interface HeatmapLineData {
    lineNumber: number;
    color: string;
    ageRatio: number; // 0 = oldest, 1 = newest
    timestamp: number;
}

/**
 * Convert HSL to RGBA string
 */
function hslToRgba(h: number, s: number, l: number, a: number): string {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 60) {
        r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
        r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
        r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
        r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
        r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
        r = c; g = 0; b = x;
    }

    const rFinal = Math.round((r + m) * 255);
    const gFinal = Math.round((g + m) * 255);
    const bFinal = Math.round((b + m) * 255);

    return `rgba(${rFinal}, ${gFinal}, ${bFinal}, ${a})`;
}

/**
 * Interpolate between two hue values
 * Handles wrapping around 360°
 */
function interpolateHue(coldHue: number, hotHue: number, ratio: number): number {
    // Direct interpolation (works well for blue → cyan → green)
    return coldHue + (hotHue - coldHue) * ratio;
}

/**
 * Generate heatmap color for a given age ratio
 * 
 * @param ageRatio - 0 = oldest, 1 = newest
 * @param config - Heatmap configuration
 * @returns RGBA color string
 */
export function getHeatmapColor(ageRatio: number, config: HeatmapConfig = DEFAULT_HEATMAP_CONFIG): string {
    const hue = interpolateHue(config.coldHue, config.hotHue, ageRatio);
    return hslToRgba(hue, config.saturation, config.lightness, config.opacity);
}

/**
 * Calculate heatmap data for all lines in a blame result
 * 
 * @param blameResult - Parsed blame result
 * @param config - Heatmap configuration
 * @returns Array of line data with colors
 */
export function calculateHeatmap(
    blameResult: BlameParseResult,
    config: HeatmapConfig = DEFAULT_HEATMAP_CONFIG
): HeatmapLineData[] {
    const lines: HeatmapLineData[] = [];
    
    // Find min and max timestamps (excluding uncommitted)
    let minTime = Infinity;
    let maxTime = -Infinity;
    
    blameResult.lines.forEach(info => {
        if (!info.isUncommitted && info.authorTime > 0) {
            minTime = Math.min(minTime, info.authorTime);
            maxTime = Math.max(maxTime, info.authorTime);
        }
    });

    // Handle edge cases
    if (minTime === Infinity || maxTime === -Infinity) {
        return lines;
    }

    const timeRange = maxTime - minTime;
    
    blameResult.lines.forEach((info, lineNumber) => {
        if (info.isUncommitted) {
            return; // Uncommitted lines handled separately
        }

        // Calculate age ratio (0 = oldest, 1 = newest)
        let ageRatio = 0;
        if (timeRange > 0) {
            ageRatio = (info.authorTime - minTime) / timeRange;
        }

        const color = getHeatmapColor(ageRatio, config);
        
        lines.push({
            lineNumber,
            color,
            ageRatio,
            timestamp: info.authorTime,
        });
    });

    return lines.sort((a, b) => a.lineNumber - b.lineNumber);
}

/**
 * Get unique colors needed for heatmap (for decoration optimization)
 * Groups lines by similar age ratio to reduce number of decorations
 * 
 * @param heatmapData - Calculated heatmap data
 * @param buckets - Number of color buckets (default 20)
 * @returns Map of bucket index to { color, lines }
 */
export function groupHeatmapByColor(
    heatmapData: HeatmapLineData[],
    buckets: number = 20,
    config: HeatmapConfig = DEFAULT_HEATMAP_CONFIG
): Map<number, { color: string; lines: number[] }> {
    const groups = new Map<number, { color: string; lines: number[] }>();

    for (const data of heatmapData) {
        const bucketIndex = Math.min(
            Math.floor(data.ageRatio * buckets),
            buckets - 1
        );

        if (!groups.has(bucketIndex)) {
            // Calculate color for this bucket
            const bucketRatio = (bucketIndex + 0.5) / buckets;
            const color = getHeatmapColor(bucketRatio, config);
            groups.set(bucketIndex, { color, lines: [] });
        }

        groups.get(bucketIndex)!.lines.push(data.lineNumber);
    }

    return groups;
}

/**
 * Get age bracket description for a line
 * 
 * @param ageRatio - 0 = oldest, 1 = newest
 * @returns Human-readable age description
 */
export function getAgeBracket(ageRatio: number): string {
    if (ageRatio >= 0.9) return 'Very Recent';
    if (ageRatio >= 0.7) return 'Recent';
    if (ageRatio >= 0.5) return 'Moderate';
    if (ageRatio >= 0.3) return 'Old';
    return 'Very Old';
}
