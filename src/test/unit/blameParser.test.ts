/**
 * Blame Parser Unit Tests
 */

import * as assert from 'assert';
import { 
    parseBlameOutput, 
    filterLinesByTime, 
    getUncommittedLines,
    getBlameForLine
} from '../../blame/blameParser';

describe('Blame Parser', () => {
    // Sample git blame --line-porcelain output
    const SAMPLE_BLAME_OUTPUT = `abc123def456789012345678901234567890abcd 1 1 1
author John Doe
author-mail <john@example.com>
author-time 1718452800
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1718452800
committer-tz +0000
summary Initial commit
filename test.ts
\tconst x = 1;
def456789012345678901234567890abcdef1234 2 2 1
author Jane Smith
author-mail <jane@example.com>
author-time 1718366400
author-tz +0000
committer Jane Smith
committer-mail <jane@example.com>
committer-time 1718366400
committer-tz +0000
summary Add feature
filename test.ts
\tconst y = 2;
0000000000000000000000000000000000000000 3 3 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1718539200
author-tz +0000
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1718539200
committer-tz +0000
summary 
filename test.ts
\tconst z = 3;
`;

    describe('parseBlameOutput', () => {
        it('should parse valid blame output', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.lineCount, 3);
            assert.strictEqual(result.lines.size, 3);
        });

        it('should extract correct line information', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            const line1 = result.lines.get(1);
            assert.ok(line1);
            assert.strictEqual(line1.lineNumber, 1);
            assert.strictEqual(line1.author, 'John Doe');
            assert.strictEqual(line1.authorMail, '<john@example.com>');
            assert.strictEqual(line1.authorTime, 1718452800);
            assert.strictEqual(line1.summary, 'Initial commit');
            assert.strictEqual(line1.commitSha, 'abc123def456789012345678901234567890abcd');
            assert.strictEqual(line1.isUncommitted, false);
        });

        it('should detect uncommitted lines by SHA', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            const line3 = result.lines.get(3);
            assert.ok(line3);
            assert.strictEqual(line3.isUncommitted, true);
        });

        it('should detect uncommitted lines by author name', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            const line3 = result.lines.get(3);
            assert.ok(line3);
            assert.strictEqual(line3.author, 'Not Committed Yet');
            assert.strictEqual(line3.isUncommitted, true);
        });

        it('should handle empty input', () => {
            const result = parseBlameOutput('');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.lineCount, 0);
        });

        it('should handle whitespace-only input', () => {
            const result = parseBlameOutput('   \n\n   ');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.lineCount, 0);
        });
    });

    describe('filterLinesByTime', () => {
        it('should filter lines by cutoff timestamp', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            // Cutoff: 1718400000000 ms (between line 1 and line 2 timestamps)
            // Line 1: 1718452800 seconds = 1718452800000 ms - should be included
            // Line 2: 1718366400 seconds = 1718366400000 ms - should NOT be included
            const cutoff = 1718400000 * 1000; // Convert to ms
            const recentLines = filterLinesByTime(result, cutoff);
            
            assert.ok(recentLines.includes(1)); // 1718452800 >= 1718400000
            assert.ok(!recentLines.includes(2)); // 1718366400 < 1718400000
            assert.ok(!recentLines.includes(3)); // Uncommitted - handled separately
        });

        it('should exclude uncommitted lines', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            // Very old cutoff - should include all committed lines
            const cutoff = 1000000000 * 1000;
            const recentLines = filterLinesByTime(result, cutoff);
            
            // Should not include line 3 (uncommitted)
            assert.ok(!recentLines.includes(3));
        });

        it('should return sorted line numbers', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            
            const cutoff = 1000000000 * 1000; // Very old - include everything
            const recentLines = filterLinesByTime(result, cutoff);
            
            // Should be sorted
            for (let i = 1; i < recentLines.length; i++) {
                assert.ok(recentLines[i] > recentLines[i - 1]);
            }
        });
    });

    describe('getUncommittedLines', () => {
        it('should return uncommitted line numbers', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            const uncommitted = getUncommittedLines(result);
            
            assert.deepStrictEqual(uncommitted, [3]);
        });

        it('should return empty array when no uncommitted lines', () => {
            const blameWithoutUncommitted = `abc123def456789012345678901234567890abcd 1 1 1
author John Doe
author-mail <john@example.com>
author-time 1718452800
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1718452800
committer-tz +0000
summary Initial commit
filename test.ts
\tconst x = 1;
`;
            const result = parseBlameOutput(blameWithoutUncommitted);
            const uncommitted = getUncommittedLines(result);
            
            assert.deepStrictEqual(uncommitted, []);
        });
    });

    describe('getBlameForLine', () => {
        it('should return blame info for existing line', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            const info = getBlameForLine(result, 1);
            
            assert.ok(info);
            assert.strictEqual(info.author, 'John Doe');
        });

        it('should return undefined for non-existent line', () => {
            const result = parseBlameOutput(SAMPLE_BLAME_OUTPUT);
            const info = getBlameForLine(result, 100);
            
            assert.strictEqual(info, undefined);
        });
    });

    describe('edge cases', () => {
        it('should handle blame with renamed file', () => {
            const blameWithRename = `abc123def456789012345678901234567890abcd 1 1 1
author John Doe
author-mail <john@example.com>
author-time 1718452800
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1718452800
committer-tz +0000
summary Initial commit
previous def456789012345678901234567890abcdef12 old-name.ts
filename new-name.ts
\tconst x = 1;
`;
            const result = parseBlameOutput(blameWithRename);
            
            assert.strictEqual(result.success, true);
            const line1 = result.lines.get(1);
            assert.ok(line1);
            assert.strictEqual(line1.filename, 'new-name.ts');
        });

        it('should handle multi-line blocks', () => {
            // When multiple consecutive lines have the same commit,
            // git may use abbreviated format, but --line-porcelain
            // should give full info for each line
            const multiLineBlame = `abc123def456789012345678901234567890abcd 1 1 3
author John Doe
author-mail <john@example.com>
author-time 1718452800
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1718452800
committer-tz +0000
summary Initial commit
filename test.ts
\tline 1
abc123def456789012345678901234567890abcd 2 2
author John Doe
author-mail <john@example.com>
author-time 1718452800
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1718452800
committer-tz +0000
summary Initial commit
filename test.ts
\tline 2
abc123def456789012345678901234567890abcd 3 3
author John Doe
author-mail <john@example.com>
author-time 1718452800
author-tz +0000
committer John Doe
committer-mail <john@example.com>
committer-time 1718452800
committer-tz +0000
summary Initial commit
filename test.ts
\tline 3
`;
            const result = parseBlameOutput(multiLineBlame);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.lineCount, 3);
        });
    });
});
