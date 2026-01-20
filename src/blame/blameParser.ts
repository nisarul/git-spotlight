/**
 * Blame Parser
 * 
 * Parses git blame --line-porcelain output into structured data.
 * 
 * Porcelain format for each line looks like:
 * ```
 * <sha> <original-line> <final-line> [<num-lines>]
 * author <name>
 * author-mail <email>
 * author-time <timestamp>
 * author-tz <timezone>
 * committer <name>
 * committer-mail <email>
 * committer-time <timestamp>
 * committer-tz <timezone>
 * summary <commit message first line>
 * [previous <sha> <filename>]
 * [boundary]
 * filename <filename>
 * \t<content>
 * ```
 * 
 * With --line-porcelain, each line gets the full info (not abbreviated).
 */

/**
 * Information about a single line from git blame
 */
export interface BlameLineInfo {
    /** Line number (1-indexed) */
    lineNumber: number;
    /** Commit SHA (40 characters, or special markers for uncommitted) */
    commitSha: string;
    /** Author name */
    author: string;
    /** Author email */
    authorMail: string;
    /** Author time as Unix timestamp (seconds since epoch) */
    authorTime: number;
    /** Author timezone offset */
    authorTz: string;
    /** Commit summary (first line of commit message) */
    summary: string;
    /** Whether this line is uncommitted (working tree or index) */
    isUncommitted: boolean;
    /** The original filename (may differ due to renames) */
    filename: string;
}

/**
 * Result of parsing blame output
 */
export interface BlameParseResult {
    /** Whether parsing was successful */
    success: boolean;
    /** Parsed line information (indexed by line number) */
    lines: Map<number, BlameLineInfo>;
    /** Error message if parsing failed */
    error?: string;
    /** Total number of lines parsed */
    lineCount: number;
}

/**
 * Special commit SHA prefixes that indicate uncommitted changes
 * - 0000000... indicates uncommitted changes (all zeros)
 * - Sometimes marked with ^ prefix for boundary commits
 */
const UNCOMMITTED_SHA_PREFIX = '0000000000000000000000000000000000000000';

/**
 * Parse git blame --line-porcelain output
 * 
 * @param blameOutput - Raw blame output string
 * @returns Parsed blame information
 */
export function parseBlameOutput(blameOutput: string): BlameParseResult {
    const lines = new Map<number, BlameLineInfo>();
    
    if (!blameOutput || !blameOutput.trim()) {
        return {
            success: true,
            lines,
            lineCount: 0,
        };
    }

    try {
        const rawLines = blameOutput.split('\n');
        let i = 0;

        while (i < rawLines.length) {
            const line = rawLines[i];
            
            // Skip empty lines
            if (!line.trim()) {
                i++;
                continue;
            }

            // First line of a block should be: <sha> <orig-line> <final-line> [<count>]
            const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
            
            if (!headerMatch) {
                // Content line (starts with tab) - skip as we already processed this block
                if (line.startsWith('\t')) {
                    i++;
                    continue;
                }
                // Unknown format, skip
                i++;
                continue;
            }

            const commitSha = headerMatch[1];
            const finalLine = parseInt(headerMatch[3], 10);

            // Initialize blame info for this line
            const blameInfo: BlameLineInfo = {
                lineNumber: finalLine,
                commitSha,
                author: '',
                authorMail: '',
                authorTime: 0,
                authorTz: '',
                summary: '',
                isUncommitted: commitSha === UNCOMMITTED_SHA_PREFIX,
                filename: '',
            };

            // Parse the following metadata lines
            i++;
            while (i < rawLines.length) {
                const metaLine = rawLines[i];
                
                // Content line starts with tab - end of metadata for this line
                if (metaLine.startsWith('\t')) {
                    i++;
                    break;
                }

                // Parse metadata fields
                if (metaLine.startsWith('author ')) {
                    blameInfo.author = metaLine.substring(7);
                } else if (metaLine.startsWith('author-mail ')) {
                    blameInfo.authorMail = metaLine.substring(12);
                } else if (metaLine.startsWith('author-time ')) {
                    blameInfo.authorTime = parseInt(metaLine.substring(12), 10);
                } else if (metaLine.startsWith('author-tz ')) {
                    blameInfo.authorTz = metaLine.substring(10);
                } else if (metaLine.startsWith('summary ')) {
                    blameInfo.summary = metaLine.substring(8);
                } else if (metaLine.startsWith('filename ')) {
                    blameInfo.filename = metaLine.substring(9);
                }
                // Skip other fields: committer*, previous, boundary

                i++;
            }

            // Check for "Not Committed Yet" author which indicates uncommitted changes
            if (blameInfo.author === 'Not Committed Yet' || 
                blameInfo.author.toLowerCase().includes('not committed')) {
                blameInfo.isUncommitted = true;
            }

            lines.set(blameInfo.lineNumber, blameInfo);
        }

        return {
            success: true,
            lines,
            lineCount: lines.size,
        };
    } catch (error) {
        return {
            success: false,
            lines: new Map(),
            lineCount: 0,
            error: `Failed to parse blame output: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Filter blame lines to only those modified after a given timestamp
 * 
 * @param blameResult - Parsed blame result
 * @param cutoffTimestamp - Unix timestamp in milliseconds
 * @returns Line numbers that were modified after the cutoff
 */
export function filterLinesByTime(
    blameResult: BlameParseResult,
    cutoffTimestamp: number
): number[] {
    const recentLines: number[] = [];
    const cutoffSeconds = cutoffTimestamp / 1000; // Convert to seconds for comparison with git

    blameResult.lines.forEach((info, lineNumber) => {
        // Include uncommitted lines separately (they're handled by another filter)
        if (!info.isUncommitted && info.authorTime >= cutoffSeconds) {
            recentLines.push(lineNumber);
        }
    });

    return recentLines.sort((a, b) => a - b);
}

/**
 * Get all uncommitted line numbers from blame result
 * 
 * @param blameResult - Parsed blame result
 * @returns Array of uncommitted line numbers
 */
export function getUncommittedLines(blameResult: BlameParseResult): number[] {
    const uncommittedLines: number[] = [];

    blameResult.lines.forEach((info, lineNumber) => {
        if (info.isUncommitted) {
            uncommittedLines.push(lineNumber);
        }
    });

    return uncommittedLines.sort((a, b) => a - b);
}

/**
 * Get blame info for a specific line
 * 
 * @param blameResult - Parsed blame result
 * @param lineNumber - Line number (1-indexed)
 * @returns Blame info or undefined
 */
export function getBlameForLine(
    blameResult: BlameParseResult,
    lineNumber: number
): BlameLineInfo | undefined {
    return blameResult.lines.get(lineNumber);
}
