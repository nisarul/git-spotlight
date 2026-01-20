/**
 * Time Parser Utility
 * 
 * Parses duration strings like "7d", "30d", "3m", "90d" or ISO dates
 * into Unix timestamps for comparison with git commit times.
 */

/**
 * Parsed duration result
 */
export interface ParsedDuration {
    /** Whether parsing was successful */
    success: boolean;
    /** The cutoff timestamp (commits >= this are "recent") */
    cutoffTimestamp?: number;
    /** Human-readable description of the duration */
    description?: string;
    /** Error message if parsing failed */
    error?: string;
}

/**
 * Duration unit multipliers in milliseconds
 */
const DURATION_UNITS: Record<string, number> = {
    'd': 24 * 60 * 60 * 1000,      // days
    'w': 7 * 24 * 60 * 60 * 1000,  // weeks
    'm': 30 * 24 * 60 * 60 * 1000, // months (approximated to 30 days)
    'y': 365 * 24 * 60 * 60 * 1000, // years (approximated to 365 days)
};

/**
 * Parse a duration string into a cutoff timestamp
 * 
 * Supported formats:
 * - "7d" - 7 days ago
 * - "2w" - 2 weeks ago
 * - "3m" - 3 months ago (30 days each)
 * - "1y" - 1 year ago
 * - ISO date string (e.g., "2024-01-15")
 * - Unix timestamp (number as string)
 * 
 * @param duration - Duration string to parse
 * @param now - Current timestamp (defaults to Date.now(), useful for testing)
 * @returns Parsed duration result
 */
export function parseDuration(duration: string, now: number = Date.now()): ParsedDuration {
    const trimmed = duration.trim().toLowerCase();

    if (!trimmed) {
        return { success: false, error: 'Duration string is empty' };
    }

    // Try relative duration format (e.g., "7d", "3m")
    const relativeMatch = trimmed.match(/^(\d+)([dwmy])$/);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2];
        const multiplier = DURATION_UNITS[unit];

        if (amount <= 0) {
            return { success: false, error: 'Duration amount must be positive' };
        }

        const cutoffTimestamp = now - (amount * multiplier);
        const unitNames: Record<string, string> = {
            'd': amount === 1 ? 'day' : 'days',
            'w': amount === 1 ? 'week' : 'weeks',
            'm': amount === 1 ? 'month' : 'months',
            'y': amount === 1 ? 'year' : 'years',
        };

        return {
            success: true,
            cutoffTimestamp,
            description: `${amount} ${unitNames[unit]}`,
        };
    }

    // Try ISO date format (e.g., "2024-01-15" or "2024-01-15T10:30:00Z")
    const dateMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
        const date = new Date(trimmed);
        if (!isNaN(date.getTime())) {
            const cutoffTimestamp = date.getTime();
            
            // Validate the date is not in the future
            if (cutoffTimestamp > now) {
                return { success: false, error: 'Date cannot be in the future' };
            }

            return {
                success: true,
                cutoffTimestamp,
                description: `since ${date.toLocaleDateString()}`,
            };
        }
    }

    // Try Unix timestamp (as string)
    const timestampMatch = trimmed.match(/^\d{10,13}$/);
    if (timestampMatch) {
        let timestamp = parseInt(trimmed, 10);
        // Convert seconds to milliseconds if needed
        if (trimmed.length === 10) {
            timestamp *= 1000;
        }

        if (timestamp > now) {
            return { success: false, error: 'Timestamp cannot be in the future' };
        }

        const date = new Date(timestamp);
        return {
            success: true,
            cutoffTimestamp: timestamp,
            description: `since ${date.toLocaleDateString()}`,
        };
    }

    return {
        success: false,
        error: `Invalid duration format: "${duration}". Use formats like "7d", "3m", "1y", or an ISO date.`,
    };
}

/**
 * Format a Unix timestamp (in seconds) to a human-readable date string
 * @param unixSeconds - Unix timestamp in seconds
 * @returns Formatted date string
 */
export function formatTimestamp(unixSeconds: number): string {
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Calculate relative time description from a Unix timestamp
 * @param unixSeconds - Unix timestamp in seconds
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Human-readable relative time (e.g., "2 days ago")
 */
export function getRelativeTime(unixSeconds: number, now: number = Date.now()): string {
    const diffMs = now - (unixSeconds * 1000);
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears > 0) {
        return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
    }
    if (diffMonths > 0) {
        return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
    }
    if (diffWeeks > 0) {
        return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
    }
    if (diffDays > 0) {
        return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    }
    if (diffHours > 0) {
        return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    }
    if (diffMinutes > 0) {
        return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
    }
    return 'just now';
}

/**
 * Validate if a string looks like a valid duration
 * @param duration - Duration string to validate
 * @returns true if the format appears valid
 */
export function isValidDurationFormat(duration: string): boolean {
    return parseDuration(duration).success;
}
