/**
 * Color Generator Utility
 * 
 * Generates consistent, visually distinct colors for authors and commits.
 * Uses a hash-based approach to ensure the same input always produces
 * the same color, making it easy to identify patterns.
 */

/**
 * Simple string hash function (djb2 algorithm)
 * Produces consistent numeric hash for any string
 * 
 * @param str - String to hash
 * @returns Numeric hash value
 */
function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

/**
 * Convert HSL to RGBA string
 * 
 * @param h - Hue (0-360)
 * @param s - Saturation (0-100)
 * @param l - Lightness (0-100)
 * @param a - Alpha (0-1)
 * @returns RGBA color string
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
 * Generate a consistent color for a given string (author name, commit SHA, etc.)
 * 
 * @param identifier - The string to generate a color for
 * @param saturation - Color saturation (0-100, default 65)
 * @param lightness - Color lightness (0-100, default 40)
 * @param opacity - Color opacity (0-1, default 0.25)
 * @returns RGBA color string
 */
export function generateColor(
    identifier: string,
    saturation: number = 65,
    lightness: number = 40,
    opacity: number = 0.25
): string {
    const hash = hashString(identifier);
    // Use golden angle (137.5°) for better color distribution
    const hue = (hash * 137.508) % 360;
    return hslToRgba(hue, saturation, lightness, opacity);
}

/**
 * Generate a color map for multiple identifiers
 * Ensures each identifier gets a unique, consistent color
 * 
 * @param identifiers - Array of strings to generate colors for
 * @param saturation - Color saturation (0-100)
 * @param lightness - Color lightness (0-100)
 * @param opacity - Color opacity (0-1)
 * @returns Map of identifier to color string
 */
export function generateColorMap(
    identifiers: string[],
    saturation: number = 65,
    lightness: number = 40,
    opacity: number = 0.25
): Map<string, string> {
    const colorMap = new Map<string, string>();
    const uniqueIdentifiers = [...new Set(identifiers)];

    for (const id of uniqueIdentifiers) {
        colorMap.set(id, generateColor(id, saturation, lightness, opacity));
    }

    return colorMap;
}

/**
 * Pre-defined color palette for small number of items
 * These are hand-picked for maximum visual distinction
 */
const DISTINCT_COLORS = [
    { h: 210, s: 60, l: 50 },  // Steel Blue
    { h: 175, s: 55, l: 45 },  // Teal
    { h: 145, s: 50, l: 42 },  // Sea Green
    { h: 195, s: 65, l: 48 },  // Sky Blue
    { h: 260, s: 45, l: 55 },  // Lavender
    { h: 190, s: 70, l: 42 },  // Cyan
    { h: 230, s: 50, l: 55 },  // Periwinkle
    { h: 160, s: 45, l: 45 },  // Aquamarine
    { h: 280, s: 40, l: 50 },  // Soft Purple
    { h: 220, s: 55, l: 52 },  // Cornflower
];

/**
 * Generate colors for a small set (up to 10) using distinct hand-picked colors
 * Falls back to hash-based colors for larger sets
 * 
 * @param identifiers - Array of identifiers
 * @param opacity - Color opacity (0-1)
 * @returns Map of identifier to color string
 */
export function generateDistinctColorMap(
    identifiers: string[],
    opacity: number = 0.25
): Map<string, string> {
    const colorMap = new Map<string, string>();
    const uniqueIdentifiers = [...new Set(identifiers)];

    if (uniqueIdentifiers.length <= DISTINCT_COLORS.length) {
        // Use pre-defined distinct colors
        uniqueIdentifiers.forEach((id, index) => {
            const { h, s, l } = DISTINCT_COLORS[index];
            colorMap.set(id, hslToRgba(h, s, l, opacity));
        });
    } else {
        // Fall back to hash-based generation for larger sets
        return generateColorMap(uniqueIdentifiers, 65, 40, opacity);
    }

    return colorMap;
}

/**
 * Get contrasting text color (black or white) for a given background
 * Useful for overlays or badges
 * 
 * @param backgroundColor - Background color in rgba format
 * @returns 'black' or 'white'
 */
export function getContrastingTextColor(backgroundColor: string): 'black' | 'white' {
    // Extract RGB values from rgba string
    const match = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) {
        return 'white';
    }

    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);

    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? 'black' : 'white';
}
