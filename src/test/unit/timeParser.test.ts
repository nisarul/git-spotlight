/**
 * Time Parser Unit Tests
 */

import * as assert from 'assert';
import { 
    parseDuration, 
    formatTimestamp, 
    getRelativeTime,
    isValidDurationFormat 
} from '../../utils/timeParser';

describe('Time Parser', () => {
    // Fixed timestamp for consistent testing
    const NOW = new Date('2024-06-15T12:00:00Z').getTime();

    describe('parseDuration', () => {
        describe('relative durations', () => {
            it('should parse days (7d)', () => {
                const result = parseDuration('7d', NOW);
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.description, '7 days');
                
                // 7 days in milliseconds
                const expectedCutoff = NOW - (7 * 24 * 60 * 60 * 1000);
                assert.strictEqual(result.cutoffTimestamp, expectedCutoff);
            });

            it('should parse single day (1d)', () => {
                const result = parseDuration('1d', NOW);
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.description, '1 day');
            });

            it('should parse weeks (2w)', () => {
                const result = parseDuration('2w', NOW);
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.description, '2 weeks');
                
                const expectedCutoff = NOW - (14 * 24 * 60 * 60 * 1000);
                assert.strictEqual(result.cutoffTimestamp, expectedCutoff);
            });

            it('should parse months (3m)', () => {
                const result = parseDuration('3m', NOW);
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.description, '3 months');
                
                // 3 months = 90 days
                const expectedCutoff = NOW - (90 * 24 * 60 * 60 * 1000);
                assert.strictEqual(result.cutoffTimestamp, expectedCutoff);
            });

            it('should parse years (1y)', () => {
                const result = parseDuration('1y', NOW);
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.description, '1 year');
            });

            it('should handle large numbers (90d)', () => {
                const result = parseDuration('90d', NOW);
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.description, '90 days');
            });

            it('should be case insensitive', () => {
                const resultLower = parseDuration('7d', NOW);
                const resultUpper = parseDuration('7D', NOW);
                
                assert.strictEqual(resultLower.success, true);
                assert.strictEqual(resultUpper.success, true);
                assert.strictEqual(resultLower.cutoffTimestamp, resultUpper.cutoffTimestamp);
            });

            it('should handle whitespace', () => {
                const result = parseDuration('  30d  ', NOW);
                assert.strictEqual(result.success, true);
            });
        });

        describe('ISO dates', () => {
            it('should parse ISO date (YYYY-MM-DD)', () => {
                const result = parseDuration('2024-01-15', NOW);
                assert.strictEqual(result.success, true);
                assert.ok(result.description?.includes('since'));
            });

            it('should parse ISO datetime', () => {
                const result = parseDuration('2024-01-15T10:30:00Z', NOW);
                assert.strictEqual(result.success, true);
            });

            it('should reject future dates', () => {
                const result = parseDuration('2025-01-01', NOW);
                assert.strictEqual(result.success, false);
                assert.ok(result.error?.includes('future'));
            });
        });

        describe('Unix timestamps', () => {
            it('should parse 10-digit Unix timestamp (seconds)', () => {
                const timestamp = Math.floor(NOW / 1000) - 86400; // 1 day ago
                const result = parseDuration(timestamp.toString(), NOW);
                assert.strictEqual(result.success, true);
            });

            it('should parse 13-digit Unix timestamp (milliseconds)', () => {
                const timestamp = NOW - 86400000; // 1 day ago
                const result = parseDuration(timestamp.toString(), NOW);
                assert.strictEqual(result.success, true);
            });
        });

        describe('error cases', () => {
            it('should fail on empty string', () => {
                const result = parseDuration('');
                assert.strictEqual(result.success, false);
            });

            it('should fail on invalid format', () => {
                const result = parseDuration('invalid');
                assert.strictEqual(result.success, false);
                assert.ok(result.error?.includes('Invalid duration'));
            });

            it('should fail on zero amount', () => {
                const result = parseDuration('0d');
                assert.strictEqual(result.success, false);
            });

            it('should fail on negative (caught by regex)', () => {
                const result = parseDuration('-7d');
                assert.strictEqual(result.success, false);
            });

            it('should fail on invalid unit', () => {
                const result = parseDuration('7x');
                assert.strictEqual(result.success, false);
            });
        });
    });

    describe('formatTimestamp', () => {
        it('should format Unix timestamp to readable date', () => {
            const timestamp = 1718452800; // 2024-06-15 12:00:00 UTC
            const formatted = formatTimestamp(timestamp);
            
            // Should contain year, month, day
            assert.ok(formatted.includes('2024'));
            assert.ok(formatted.includes('Jun') || formatted.includes('6'));
        });
    });

    describe('getRelativeTime', () => {
        it('should return "just now" for very recent times', () => {
            const timestamp = Math.floor(NOW / 1000) - 30; // 30 seconds ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, 'just now');
        });

        it('should return minutes ago', () => {
            const timestamp = Math.floor(NOW / 1000) - 300; // 5 minutes ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '5 minutes ago');
        });

        it('should return singular minute', () => {
            const timestamp = Math.floor(NOW / 1000) - 90; // 1.5 minutes ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '1 minute ago');
        });

        it('should return hours ago', () => {
            const timestamp = Math.floor(NOW / 1000) - 7200; // 2 hours ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '2 hours ago');
        });

        it('should return days ago', () => {
            const timestamp = Math.floor(NOW / 1000) - 259200; // 3 days ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '3 days ago');
        });

        it('should return weeks ago', () => {
            const timestamp = Math.floor(NOW / 1000) - 1209600; // 2 weeks ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '2 weeks ago');
        });

        it('should return months ago', () => {
            const timestamp = Math.floor(NOW / 1000) - 7776000; // ~90 days ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '3 months ago');
        });

        it('should return years ago', () => {
            const timestamp = Math.floor(NOW / 1000) - 63072000; // ~2 years ago
            const result = getRelativeTime(timestamp, NOW);
            assert.strictEqual(result, '2 years ago');
        });
    });

    describe('isValidDurationFormat', () => {
        it('should return true for valid formats', () => {
            assert.strictEqual(isValidDurationFormat('7d'), true);
            assert.strictEqual(isValidDurationFormat('3m'), true);
            assert.strictEqual(isValidDurationFormat('2024-01-01'), true);
        });

        it('should return false for invalid formats', () => {
            assert.strictEqual(isValidDurationFormat(''), false);
            assert.strictEqual(isValidDurationFormat('invalid'), false);
            assert.strictEqual(isValidDurationFormat('7x'), false);
        });
    });
});
