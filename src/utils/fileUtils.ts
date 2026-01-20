/**
 * File Utilities
 * 
 * Helper functions for file system operations and validation.
 * Includes checks for file size, binary content detection, etc.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** Common binary file extensions to skip */
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.pyc', '.pyo', '.class', '.o', '.obj',
    '.lock', '.sqlite', '.db',
]);

/**
 * Result of file validation
 */
export interface FileValidationResult {
    /** Whether the file is valid for processing */
    valid: boolean;
    /** Reason why file is invalid (if applicable) */
    reason?: string;
}

/**
 * Check if a file should be processed based on extension
 * @param filePath - Path to the file
 * @returns true if file appears to be text-based
 */
export function isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return !BINARY_EXTENSIONS.has(ext);
}

/**
 * Get file size in kilobytes
 * @param filePath - Path to the file
 * @returns File size in KB, or -1 if file doesn't exist
 */
export function getFileSizeKB(filePath: string): number {
    try {
        const stats = fs.statSync(filePath);
        return stats.size / 1024;
    } catch {
        return -1;
    }
}

/**
 * Validate a file for git blame processing
 * @param uri - VS Code URI of the file
 * @param maxSizeKB - Maximum file size in KB
 * @returns Validation result
 */
export function validateFileForBlame(uri: vscode.Uri, maxSizeKB: number): FileValidationResult {
    // Only process file:// URIs
    if (uri.scheme !== 'file') {
        return { valid: false, reason: 'Only local files are supported' };
    }

    const filePath = uri.fsPath;

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return { valid: false, reason: 'File does not exist' };
    }

    // Check for binary files
    if (!isTextFile(filePath)) {
        return { valid: false, reason: 'Binary files are not supported' };
    }

    // Check file size
    const sizeKB = getFileSizeKB(filePath);
    if (sizeKB < 0) {
        return { valid: false, reason: 'Unable to determine file size' };
    }
    if (sizeKB > maxSizeKB) {
        return { valid: false, reason: `File too large (${Math.round(sizeKB)}KB > ${maxSizeKB}KB)` };
    }

    return { valid: true };
}

/**
 * Get the workspace folder containing a file
 * @param uri - VS Code URI of the file
 * @returns Workspace folder or undefined
 */
export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

/**
 * Get relative path from workspace root
 * @param uri - VS Code URI of the file
 * @returns Relative path or the full path if not in workspace
 */
export function getRelativePath(uri: vscode.Uri): string {
    const workspaceFolder = getWorkspaceFolder(uri);
    if (workspaceFolder) {
        return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    }
    return uri.fsPath;
}
