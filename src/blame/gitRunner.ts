/**
 * Git Runner
 * 
 * Executes git commands safely with proper error handling,
 * timeout support, and workspace awareness.
 * 
 * Uses child_process.execFile for security (no shell injection).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Result of a git command execution
 */
export interface GitCommandResult {
    /** Whether the command succeeded */
    success: boolean;
    /** Command stdout */
    stdout?: string;
    /** Command stderr */
    stderr?: string;
    /** Error message if failed */
    error?: string;
    /** Error code if applicable */
    code?: number;
}

/**
 * Options for git command execution
 */
export interface GitRunOptions {
    /** Working directory (defaults to workspace root) */
    cwd?: string;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Maximum buffer size for output */
    maxBuffer?: number;
}

/**
 * Git repository information
 */
export interface GitRepoInfo {
    /** Whether git is available */
    gitAvailable: boolean;
    /** Whether the path is in a git repository */
    isRepository: boolean;
    /** The repository root path */
    repoRoot?: string;
    /** Current HEAD commit hash */
    headCommit?: string;
    /** Current branch name (or undefined if detached) */
    branch?: string;
    /** Whether HEAD is detached */
    isDetached?: boolean;
    /** Error message if any issue occurred */
    error?: string;
}

/** Default timeout for git commands (5 seconds) */
const DEFAULT_TIMEOUT = 5000;

/** Default max buffer size (10MB to handle large blame output) */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Execute a git command
 * 
 * @param args - Git command arguments (without 'git' prefix)
 * @param options - Execution options
 * @returns Command result
 */
export async function runGitCommand(
    args: string[],
    options: GitRunOptions = {}
): Promise<GitCommandResult> {
    const {
        cwd = process.cwd(),
        timeout = DEFAULT_TIMEOUT,
        maxBuffer = DEFAULT_MAX_BUFFER,
    } = options;

    try {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd,
            timeout,
            maxBuffer,
            windowsHide: true, // Don't show command window on Windows
        });

        return {
            success: true,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
        };
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & { 
            stdout?: string; 
            stderr?: string;
            code?: number | string;
            killed?: boolean;
        };

        // Handle timeout
        if (execError.killed) {
            return {
                success: false,
                error: `Git command timed out after ${timeout}ms`,
                code: -1,
            };
        }

        // Handle git not found
        if (execError.code === 'ENOENT') {
            return {
                success: false,
                error: 'Git is not installed or not in PATH',
                code: -2,
            };
        }

        // Handle git command errors (non-zero exit)
        return {
            success: false,
            stdout: execError.stdout?.toString(),
            stderr: execError.stderr?.toString(),
            error: execError.message,
            code: typeof execError.code === 'number' ? execError.code : -1,
        };
    }
}

/**
 * Get information about the git repository containing a file
 * 
 * @param filePath - Path to a file or directory
 * @param timeout - Command timeout in milliseconds
 * @returns Repository information
 */
export async function getRepoInfo(
    filePath: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<GitRepoInfo> {
    const cwd = path.dirname(filePath);
    const options: GitRunOptions = { cwd, timeout };

    // Check if git is available
    const versionResult = await runGitCommand(['--version'], options);
    if (!versionResult.success) {
        return {
            gitAvailable: false,
            isRepository: false,
            error: versionResult.error,
        };
    }

    // Get repository root
    const rootResult = await runGitCommand(['rev-parse', '--show-toplevel'], options);
    if (!rootResult.success) {
        return {
            gitAvailable: true,
            isRepository: false,
            error: 'Not a git repository',
        };
    }

    const repoRoot = rootResult.stdout?.trim();

    // Get HEAD commit
    const headResult = await runGitCommand(['rev-parse', 'HEAD'], { cwd: repoRoot, timeout });
    if (!headResult.success) {
        return {
            gitAvailable: true,
            isRepository: true,
            repoRoot,
            error: 'Unable to get HEAD commit (empty repository?)',
        };
    }

    const headCommit = headResult.stdout?.trim();

    // Get branch information
    const branchResult = await runGitCommand(
        ['symbolic-ref', '--short', 'HEAD'],
        { cwd: repoRoot, timeout }
    );

    let branch: string | undefined;
    let isDetached = false;

    if (branchResult.success) {
        branch = branchResult.stdout?.trim();
    } else {
        // HEAD is detached
        isDetached = true;
    }

    return {
        gitAvailable: true,
        isRepository: true,
        repoRoot,
        headCommit,
        branch,
        isDetached,
    };
}

/**
 * Check if a file is tracked by git
 * 
 * @param filePath - Path to the file
 * @param repoRoot - Repository root path
 * @param timeout - Command timeout
 * @returns true if file is tracked
 */
export async function isFileTracked(
    filePath: string,
    repoRoot: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<boolean> {
    const relativePath = path.relative(repoRoot, filePath);
    const result = await runGitCommand(
        ['ls-files', '--error-unmatch', relativePath],
        { cwd: repoRoot, timeout }
    );
    return result.success;
}

/**
 * Get git blame output for a file in porcelain format
 * 
 * @param filePath - Path to the file
 * @param repoRoot - Repository root path
 * @param timeout - Command timeout
 * @returns Blame output or error
 */
export async function getBlame(
    filePath: string,
    repoRoot: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<GitCommandResult> {
    const relativePath = path.relative(repoRoot, filePath);
    
    // Use --line-porcelain for easier parsing (repeats commit info for each line)
    // Use --follow to track file renames
    return runGitCommand(
        ['blame', '--line-porcelain', '--follow', relativePath],
        { cwd: repoRoot, timeout }
    );
}

/**
 * Get current HEAD commit hash
 * 
 * @param repoRoot - Repository root path
 * @param timeout - Command timeout
 * @returns HEAD commit hash or undefined
 */
export async function getHeadCommit(
    repoRoot: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<string | undefined> {
    const result = await runGitCommand(['rev-parse', 'HEAD'], { cwd: repoRoot, timeout });
    return result.success ? result.stdout?.trim() : undefined;
}

/**
 * Get the workspace folder containing a file, for multi-root workspace support
 * 
 * @param uri - VS Code URI
 * @returns Workspace folder or undefined
 */
export function getWorkspaceFolderForFile(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

/**
 * Get list of available branches
 * 
 * @param repoRoot - Repository root path
 * @param timeout - Command timeout
 * @returns Array of branch names
 */
export async function getBranches(
    repoRoot: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<string[]> {
    const result = await runGitCommand(
        ['branch', '-a', '--format=%(refname:short)'],
        { cwd: repoRoot, timeout }
    );
    
    if (!result.success || !result.stdout) {
        return [];
    }

    return result.stdout
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0);
}

/**
 * Get merge base between current HEAD and a branch
 * 
 * @param repoRoot - Repository root path
 * @param branch - Branch name to compare against
 * @param timeout - Command timeout
 * @returns Merge base commit SHA or undefined
 */
export async function getMergeBase(
    repoRoot: string,
    branch: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<string | undefined> {
    const result = await runGitCommand(
        ['merge-base', 'HEAD', branch],
        { cwd: repoRoot, timeout }
    );
    return result.success ? result.stdout?.trim() : undefined;
}

/**
 * Get list of commits between two refs
 * 
 * @param repoRoot - Repository root path
 * @param baseRef - Base reference (branch or commit)
 * @param timeout - Command timeout
 * @returns Array of commit SHAs
 */
export async function getCommitsSince(
    repoRoot: string,
    baseRef: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<string[]> {
    const result = await runGitCommand(
        ['rev-list', `${baseRef}..HEAD`],
        { cwd: repoRoot, timeout }
    );
    
    if (!result.success || !result.stdout) {
        return [];
    }

    return result.stdout
        .split('\n')
        .map(sha => sha.trim())
        .filter(sha => sha.length > 0);
}

/**
 * Get the remote origin URL
 * 
 * @param repoRoot - Repository root path
 * @param timeout - Command timeout
 * @returns Remote URL or undefined
 */
export async function getRemoteUrl(
    repoRoot: string,
    timeout: number = DEFAULT_TIMEOUT
): Promise<string | undefined> {
    const result = await runGitCommand(
        ['config', '--get', 'remote.origin.url'],
        { cwd: repoRoot, timeout }
    );
    return result.success ? result.stdout?.trim() : undefined;
}

/**
 * Parse a git remote URL into a web URL for viewing commits
 * Supports GitHub, GitLab, Bitbucket, and Azure DevOps
 * 
 * @param remoteUrl - Git remote URL (SSH or HTTPS)
 * @param commitSha - Full commit SHA
 * @returns Web URL to view the commit, or undefined if unsupported
 */
export function getCommitUrl(remoteUrl: string, commitSha: string): string | undefined {
    if (!remoteUrl || !commitSha) {
        return undefined;
    }

    let webUrl: string | undefined;

    // SSH format: git@github.com:user/repo.git
    // HTTPS format: https://github.com/user/repo.git
    
    // GitHub
    const githubSshMatch = remoteUrl.match(/git@github\.com[:/](.+?)(?:\.git)?$/);
    const githubHttpsMatch = remoteUrl.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
    if (githubSshMatch) {
        webUrl = `https://github.com/${githubSshMatch[1]}/commit/${commitSha}`;
    } else if (githubHttpsMatch) {
        webUrl = `https://github.com/${githubHttpsMatch[1]}/commit/${commitSha}`;
    }

    // GitLab
    const gitlabSshMatch = remoteUrl.match(/git@gitlab\.com[:/](.+?)(?:\.git)?$/);
    const gitlabHttpsMatch = remoteUrl.match(/https?:\/\/gitlab\.com\/(.+?)(?:\.git)?$/);
    if (gitlabSshMatch) {
        webUrl = `https://gitlab.com/${gitlabSshMatch[1]}/-/commit/${commitSha}`;
    } else if (gitlabHttpsMatch) {
        webUrl = `https://gitlab.com/${gitlabHttpsMatch[1]}/-/commit/${commitSha}`;
    }

    // Bitbucket
    const bitbucketSshMatch = remoteUrl.match(/git@bitbucket\.org[:/](.+?)(?:\.git)?$/);
    const bitbucketHttpsMatch = remoteUrl.match(/https?:\/\/bitbucket\.org\/(.+?)(?:\.git)?$/);
    if (bitbucketSshMatch) {
        webUrl = `https://bitbucket.org/${bitbucketSshMatch[1]}/commits/${commitSha}`;
    } else if (bitbucketHttpsMatch) {
        webUrl = `https://bitbucket.org/${bitbucketHttpsMatch[1]}/commits/${commitSha}`;
    }

    // Azure DevOps (dev.azure.com)
    const azureDevOpsMatch = remoteUrl.match(/https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+?)(?:\.git)?$/);
    const azureDevOpsSshMatch = remoteUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (azureDevOpsMatch) {
        const [, org, project, repo] = azureDevOpsMatch;
        webUrl = `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${commitSha}`;
    } else if (azureDevOpsSshMatch) {
        const [, org, project, repo] = azureDevOpsSshMatch;
        webUrl = `https://dev.azure.com/${org}/${project}/_git/${repo}/commit/${commitSha}`;
    }

    // Self-hosted GitLab (generic pattern)
    if (!webUrl) {
        const genericGitlabSshMatch = remoteUrl.match(/git@([^:]+)[:/](.+?)(?:\.git)?$/);
        const genericGitlabHttpsMatch = remoteUrl.match(/https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
        if (genericGitlabSshMatch) {
            // Assume GitLab-style URL for self-hosted
            webUrl = `https://${genericGitlabSshMatch[1]}/${genericGitlabSshMatch[2]}/-/commit/${commitSha}`;
        } else if (genericGitlabHttpsMatch) {
            webUrl = `https://${genericGitlabHttpsMatch[1]}/${genericGitlabHttpsMatch[2]}/-/commit/${commitSha}`;
        }
    }

    return webUrl;
}
