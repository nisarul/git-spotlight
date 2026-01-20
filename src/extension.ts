/**
 * Git Spotlight - VS Code Extension
 * 
 * Visualize Git blame with intelligent line highlighting.
 * Supports multiple modes: by age, author, commit, heatmap, or specific selection.
 * 
 * @version 3.0.0
 */

import * as vscode from 'vscode';
import { getSettings, onSettingsChanged, ExtensionSettings } from './config/settings';
import { getRepoInfo, getBlame, getHeadCommit, isFileTracked, GitRepoInfo, getRemoteUrl, getBranches, getDiffLines } from './blame/gitRunner';
import { parseBlameOutput, filterLinesByTime, getUncommittedLines, BlameParseResult } from './blame/blameParser';
import { getBlameCache, BlameCache } from './blame/blameCache';
import { LineDecorator, createLineDecorator, HighlightMode } from './highlight/decorator';
import { GutterDecorator, createGutterDecorator } from './highlight/gutterDecorator';
import { FileStatisticsPanel, calculateFileStatistics } from './views/fileStatistics';
import { parseDuration, ParsedDuration } from './utils/timeParser';
import { validateFileForBlame } from './utils/fileUtils';
import { debounce } from './utils/debounce';

/**
 * Extension state manager
 */
class GitSpotlightExtension {
    /** Current highlight mode */
    private mode: HighlightMode = 'none';

    /** Duration for age-based highlighting */
    private duration: string;

    /** Parsed duration */
    private parsedDuration: ParsedDuration | undefined;

    /** Selected author for specific author mode */
    private selectedAuthor: string | undefined;

    /** Selected commit for specific commit mode */
    private selectedCommit: string | undefined;

    /** Selected branch for branch diff mode */
    private selectedBranch: string | undefined;

    /** Extension settings */
    private settings: ExtensionSettings;

    /** Line decorator instance */
    private decorator: LineDecorator;

    /** Gutter decorator instance */
    private gutterDecorator: GutterDecorator;

    /** Blame cache instance */
    private cache: BlameCache;

    /** Status bar item */
    private statusBarItem: vscode.StatusBarItem;

    /** Navigation status bar items */
    private prevButton: vscode.StatusBarItem;
    private nextButton: vscode.StatusBarItem;

    /** Debounced refresh function */
    private debouncedRefresh: ReturnType<typeof debounce>;

    /** Disposables for cleanup */
    private disposables: vscode.Disposable[] = [];

    /** Last known HEAD per workspace folder */
    private lastKnownHead: Map<string, string> = new Map();

    /** Git HEAD file watchers */
    private gitHeadWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

    /** Extension URI for webview resources */
    private extensionUri: vscode.Uri | undefined;

    constructor(extensionUri?: vscode.Uri) {
        this.extensionUri = extensionUri;
        this.settings = getSettings();
        this.duration = this.settings.duration;
        this.decorator = createLineDecorator(this.settings);
        this.gutterDecorator = createGutterDecorator(this.settings);
        this.cache = getBlameCache();

        // Create navigation buttons (higher priority = more left)
        this.prevButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            102
        );
        this.prevButton.text = '$(arrow-up)';
        this.prevButton.tooltip = 'Previous Highlight (Alt+[)';
        this.prevButton.command = 'gitSpotlight.goToPreviousHighlight';

        this.nextButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            101
        );
        this.nextButton.text = '$(arrow-down)';
        this.nextButton.tooltip = 'Next Highlight (Alt+])';
        this.nextButton.command = 'gitSpotlight.goToNextHighlight';

        // Create main status bar
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'gitSpotlight.clear';
        this.updateStatusBar();
        this.statusBarItem.show();

        // Create debounced refresh
        this.debouncedRefresh = debounce(
            () => this.refreshActiveEditor(),
            this.settings.debounceDelay
        );

        this.registerEventListeners();
    }

    /**
     * Public getter for current mode (for external access)
     */
    public get currentMode(): HighlightMode {
        return this.mode;
    }

    /**
     * Register all event listeners
     */
    private registerEventListeners(): void {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                if (this.mode !== 'none') {
                    this.debouncedRefresh();
                }
            })
        );

        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (this.mode !== 'none' && this.isActiveDocument(doc)) {
                    this.cache.delete(doc.uri.fsPath);
                    this.debouncedRefresh();
                }
            })
        );

        this.disposables.push(
            onSettingsChanged((newSettings) => {
                this.onSettingsChanged(newSettings);
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.setupGitHeadWatchers();
            })
        );

        this.setupGitHeadWatchers();
    }

    /**
     * Set up file watchers for .git/HEAD
     */
    private setupGitHeadWatchers(): void {
        this.gitHeadWatchers.forEach(watcher => watcher.dispose());
        this.gitHeadWatchers.clear();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        for (const folder of workspaceFolders) {
            const gitHeadPattern = new vscode.RelativePattern(folder, '.git/HEAD');
            const watcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern);

            watcher.onDidChange(() => this.onGitHeadChanged(folder));
            watcher.onDidCreate(() => this.onGitHeadChanged(folder));

            this.gitHeadWatchers.set(folder.uri.fsPath, watcher);
            this.disposables.push(watcher);
        }
    }

    /**
     * Handle git HEAD changes
     */
    private async onGitHeadChanged(folder: vscode.WorkspaceFolder): Promise<void> {
        if (this.mode === 'none') {
            return;
        }

        const newHead = await getHeadCommit(folder.uri.fsPath, this.settings.gitTimeout);
        const oldHead = this.lastKnownHead.get(folder.uri.fsPath);

        if (newHead && newHead !== oldHead) {
            this.lastKnownHead.set(folder.uri.fsPath, newHead);
            this.cache.invalidateForHeadChange(newHead);
            this.debouncedRefresh();
        }
    }

    private isActiveDocument(doc: vscode.TextDocument): boolean {
        return vscode.window.activeTextEditor?.document === doc;
    }

    private onSettingsChanged(newSettings: ExtensionSettings): void {
        const oldDebounceDelay = this.settings.debounceDelay;
        this.settings = newSettings;

        this.decorator.updateSettings(newSettings);
        this.gutterDecorator.updateSettings(newSettings);

        if (newSettings.debounceDelay !== oldDebounceDelay) {
            this.debouncedRefresh.cancel();
            this.debouncedRefresh = debounce(
                () => this.refreshActiveEditor(),
                newSettings.debounceDelay
            );
        }

        if (this.mode !== 'none') {
            this.refreshActiveEditor();
        }
    }

    // ========== COMMAND HANDLERS ==========

    /**
     * Highlight by age command
     */
    async highlightByAge(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter time duration for highlighting recent changes',
            placeHolder: '7d, 30d, 3m, 90d, or ISO date',
            value: this.duration,
            validateInput: (value) => {
                const result = parseDuration(value);
                return result.success ? null : result.error;
            },
        });

        if (!input) {
            return;
        }

        this.duration = input;
        this.parsedDuration = parseDuration(input);

        if (!this.parsedDuration.success) {
            vscode.window.showErrorMessage(`Invalid duration: ${this.parsedDuration.error}`);
            return;
        }

        this.mode = 'age';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Highlight all authors command
     */
    async highlightByAuthor(): Promise<void> {
        this.mode = 'author';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Highlight all commits command
     */
    async highlightByCommit(): Promise<void> {
        this.mode = 'commit';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Highlight specific author command
     */
    async highlightSpecificAuthor(): Promise<void> {
        // First get blame data to show available authors
        const blameResult = await this.getBlameForActiveEditor();
        if (!blameResult) {
            vscode.window.showWarningMessage('Unable to get Git blame data for this file.');
            return;
        }

        const authors = LineDecorator.getAuthors(blameResult);
        if (authors.length === 0) {
            vscode.window.showInformationMessage('No authors found in this file.');
            return;
        }

        const selected = await vscode.window.showQuickPick(authors, {
            placeHolder: 'Select an author to highlight',
            title: 'Git Spotlight: Select Author',
        });

        if (!selected) {
            return;
        }

        this.selectedAuthor = selected;
        this.mode = 'specificAuthor';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Highlight specific commit command
     */
    async highlightSpecificCommit(): Promise<void> {
        const blameResult = await this.getBlameForActiveEditor();
        if (!blameResult) {
            vscode.window.showWarningMessage('Unable to get Git blame data for this file.');
            return;
        }

        const commits = LineDecorator.getCommits(blameResult);
        if (commits.length === 0) {
            vscode.window.showInformationMessage('No commits found in this file.');
            return;
        }

        const items = commits.map(c => ({
            label: c.sha.substring(0, 8),
            description: c.author,
            detail: c.summary || '(no message)',
            sha: c.sha,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a commit to highlight',
            title: 'Git Spotlight: Select Commit',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (!selected) {
            return;
        }

        this.selectedCommit = selected.sha;
        this.mode = 'specificCommit';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Clear all highlights command
     */
    clear(): void {
        this.mode = 'none';
        this.debouncedRefresh.cancel();
        this.decorator.clearAllDecorations();
        this.gutterDecorator.clearAll();
        this.updateStatusBar();
    }

    /**
     * Navigate to next highlighted line
     */
    goToNextHighlight(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor');
            return;
        }

        if (this.mode === 'none') {
            vscode.window.showInformationMessage('No highlights active. Use a Git Spotlight command first.');
            return;
        }

        const highlightedLines = this.decorator.getHighlightedLines();
        if (highlightedLines.length === 0) {
            vscode.window.showInformationMessage('No highlighted lines to navigate');
            return;
        }

        const targetLine = this.decorator.goToNextHighlight(editor);
        if (targetLine !== undefined) {
            const index = highlightedLines.indexOf(targetLine) + 1;
            vscode.window.setStatusBarMessage(`Highlight ${index}/${highlightedLines.length}`, 2000);
        }
    }

    /**
     * Navigate to previous highlighted line
     */
    goToPreviousHighlight(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor');
            return;
        }

        if (this.mode === 'none') {
            vscode.window.showInformationMessage('No highlights active. Use a Git Spotlight command first.');
            return;
        }

        const highlightedLines = this.decorator.getHighlightedLines();
        if (highlightedLines.length === 0) {
            vscode.window.showInformationMessage('No highlighted lines to navigate');
            return;
        }

        const targetLine = this.decorator.goToPreviousHighlight(editor);
        if (targetLine !== undefined) {
            const index = highlightedLines.indexOf(targetLine) + 1;
            vscode.window.setStatusBarMessage(`Highlight ${index}/${highlightedLines.length}`, 2000);
        }
    }

    /**
     * Toggle heatmap mode - gradient colors by age
     */
    async highlightHeatmap(): Promise<void> {
        if (this.mode === 'heatmap') {
            this.clear();
            return;
        }
        this.mode = 'heatmap';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Highlight branch differences - shows lines that actually differ from a selected branch
     * Uses git diff to find real differences, not commit-based comparison
     */
    async highlightBranchDiff(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const uri = editor.document.uri;
        if (uri.scheme !== 'file') {
            vscode.window.showWarningMessage('This command only works with local files.');
            return;
        }

        // Get repo info
        const repoInfo = await getRepoInfo(uri.fsPath, this.settings.gitTimeout);
        if (!repoInfo.isRepository || !repoInfo.repoRoot) {
            vscode.window.showWarningMessage('File is not in a Git repository.');
            return;
        }

        // Get list of branches
        const branches = await getBranches(repoInfo.repoRoot, this.settings.gitTimeout);
        if (branches.length === 0) {
            vscode.window.showWarningMessage('No branches found in the repository.');
            return;
        }

        // Filter to only remote branches (exclude local branches and origin/HEAD)
        const remoteBranches = branches
            .filter(b => b.startsWith('origin/') && b !== 'origin/HEAD')
            .sort();
        
        if (remoteBranches.length === 0) {
            vscode.window.showWarningMessage('No remote branches found. Try fetching from remote first.');
            return;
        }

        // Show branch picker
        const selected = await vscode.window.showQuickPick(remoteBranches, {
            placeHolder: 'Select a remote branch to compare against',
            title: 'Git Spotlight: Compare with Remote Branch',
        });

        if (!selected) {
            return;
        }

        this.selectedBranch = selected;
        this.mode = 'branchDiff';
        this.updateStatusBar();
        await this.refreshActiveEditor();
    }

    /**
     * Open side-by-side diff view comparing current file with a remote branch
     */
    async diffWithBranch(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const uri = editor.document.uri;
        if (uri.scheme !== 'file') {
            vscode.window.showWarningMessage('This command only works with local files.');
            return;
        }

        // Get repo info
        const repoInfo = await getRepoInfo(uri.fsPath, this.settings.gitTimeout);
        if (!repoInfo.isRepository || !repoInfo.repoRoot) {
            vscode.window.showWarningMessage('File is not in a Git repository.');
            return;
        }

        // Get list of remote branches
        const branches = await getBranches(repoInfo.repoRoot, this.settings.gitTimeout);
        const remoteBranches = branches
            .filter(b => b.startsWith('origin/') && b !== 'origin/HEAD')
            .sort();
        
        if (remoteBranches.length === 0) {
            vscode.window.showWarningMessage('No remote branches found. Try fetching from remote first.');
            return;
        }

        // Show branch picker
        const selected = await vscode.window.showQuickPick(remoteBranches, {
            placeHolder: 'Select a remote branch to compare against',
            title: 'Git Spotlight: Diff with Remote Branch',
        });

        if (!selected) {
            return;
        }

        // Get relative path from repo root
        const relativePath = uri.fsPath.substring(repoInfo.repoRoot.length + 1);
        const fileName = uri.fsPath.split('/').pop() || 'file';

        // Create a git URI for the file at the selected branch
        // VS Code's built-in git extension uses this URI scheme
        const gitUri = vscode.Uri.parse(`git:/${relativePath}?${encodeURIComponent(JSON.stringify({ path: uri.fsPath, ref: selected }))}`);

        // Try using VS Code's built-in git extension first
        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                gitUri,
                uri,
                `${fileName} (${selected}) ↔ ${fileName} (Working Tree)`
            );
        } catch {
            // Fallback: Try the git extension's diff command
            try {
                await vscode.commands.executeCommand('git.openChange', uri);
            } catch {
                vscode.window.showErrorMessage(
                    'Unable to open diff view. Make sure the Git extension is enabled.'
                );
            }
        }
    }

    /**
     * Show file statistics panel
     */
    async showStatistics(): Promise<void> {
        const blameResult = await this.getBlameForActiveEditor();
        if (!blameResult || !blameResult.success) {
            vscode.window.showWarningMessage('Unable to get Git blame data for this file.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Get remote URL for commit links
        let remoteUrl: string | undefined;
        try {
            const repoInfo = await getRepoInfo(editor.document.uri.fsPath, this.settings.gitTimeout);
            if (repoInfo.repoRoot) {
                remoteUrl = await getRemoteUrl(repoInfo.repoRoot, this.settings.gitTimeout);
            }
        } catch {
            // Ignore errors, just won't have commit links
        }

        const stats = calculateFileStatistics(editor.document.uri.fsPath, blameResult, remoteUrl);
        const panel = FileStatisticsPanel.createOrShow(this.extensionUri || vscode.Uri.file(''));
        panel.update(stats);
    }

    /**
     * Toggle gutter annotations
     */
    toggleGutter(): void {
        const currentSetting = this.settings.enableGutterAnnotations;
        const config = vscode.workspace.getConfiguration('gitSpotlight');
        config.update('enableGutterAnnotations', !currentSetting, vscode.ConfigurationTarget.Global);
        
        const status = !currentSetting ? 'enabled' : 'disabled';
        vscode.window.showInformationMessage(`Gutter annotations ${status}`);
    }

    // ========== CORE LOGIC ==========

    /**
     * Get blame result for active editor
     */
    private async getBlameForActiveEditor(): Promise<BlameParseResult | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }

        const uri = editor.document.uri;
        const validation = validateFileForBlame(uri, this.settings.maxFileSizeKB);
        if (!validation.valid) {
            return undefined;
        }

        try {
            const repoInfo = await getRepoInfo(uri.fsPath, this.settings.gitTimeout);
            if (!repoInfo.gitAvailable || !repoInfo.isRepository || !repoInfo.headCommit) {
                return undefined;
            }

            const repoRoot = repoInfo.repoRoot!;
            const headCommit = repoInfo.headCommit;

            const tracked = await isFileTracked(uri.fsPath, repoRoot, this.settings.gitTimeout);
            if (!tracked) {
                return undefined;
            }

            let blameResult = this.cache.get(uri.fsPath, headCommit);
            if (!blameResult) {
                const blameOutput = await getBlame(uri.fsPath, repoRoot, this.settings.gitTimeout);
                if (!blameOutput.success) {
                    return undefined;
                }

                blameResult = parseBlameOutput(blameOutput.stdout || '');
                if (blameResult.success) {
                    this.cache.set(uri.fsPath, headCommit, blameResult);
                }
            }

            return blameResult;
        } catch {
            return undefined;
        }
    }

    /**
     * Refresh decorations for active editor
     */
    private async refreshActiveEditor(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        if (this.mode === 'none') {
            this.decorator.clearAllFromEditor(editor);
            return;
        }

        const uri = editor.document.uri;
        const validation = validateFileForBlame(uri, this.settings.maxFileSizeKB);
        if (!validation.valid) {
            this.decorator.clearAllFromEditor(editor);
            return;
        }

        try {
            const repoInfo = await getRepoInfo(uri.fsPath, this.settings.gitTimeout);
            if (!this.handleRepoErrors(repoInfo)) {
                this.decorator.clearAllFromEditor(editor);
                return;
            }

            const repoRoot = repoInfo.repoRoot!;
            const headCommit = repoInfo.headCommit!;
            this.lastKnownHead.set(repoRoot, headCommit);

            // Fetch remote URL for commit links in hover
            const remoteUrl = await getRemoteUrl(repoRoot, this.settings.gitTimeout);
            this.decorator.setRemoteUrl(remoteUrl);

            const tracked = await isFileTracked(uri.fsPath, repoRoot, this.settings.gitTimeout);
            if (!tracked) {
                this.decorator.clearAllFromEditor(editor);
                return;
            }

            let blameResult = this.cache.get(uri.fsPath, headCommit);
            if (!blameResult) {
                const blameOutput = await getBlame(uri.fsPath, repoRoot, this.settings.gitTimeout);
                if (!blameOutput.success) {
                    this.decorator.clearAllFromEditor(editor);
                    return;
                }

                blameResult = parseBlameOutput(blameOutput.stdout || '');
                if (!blameResult.success) {
                    this.decorator.clearAllFromEditor(editor);
                    return;
                }

                this.cache.set(uri.fsPath, headCommit, blameResult);
            }

            const uncommittedLines = getUncommittedLines(blameResult);

            // Apply decorations based on mode
            switch (this.mode) {
                case 'age': {
                    const cutoff = this.parsedDuration?.cutoffTimestamp ?? 0;
                    const recentLines = filterLinesByTime(blameResult, cutoff);
                    this.decorator.applyAgeHighlighting(editor, blameResult, recentLines, uncommittedLines);
                    break;
                }
                case 'author':
                    this.decorator.applyAuthorHighlighting(editor, blameResult, uncommittedLines);
                    break;
                case 'commit':
                    this.decorator.applyCommitHighlighting(editor, blameResult, uncommittedLines);
                    break;
                case 'specificAuthor':
                    if (this.selectedAuthor) {
                        this.decorator.applySpecificAuthorHighlighting(editor, blameResult, this.selectedAuthor);
                    }
                    break;
                case 'specificCommit':
                    if (this.selectedCommit) {
                        this.decorator.applySpecificCommitHighlighting(editor, blameResult, this.selectedCommit);
                    }
                    break;
                case 'heatmap':
                    this.decorator.applyHeatmapHighlighting(editor, blameResult, uncommittedLines);
                    break;
                case 'branchDiff':
                    if (this.selectedBranch) {
                        // Use git diff to find actual line differences
                        const diffLines = await getDiffLines(
                            uri.fsPath,
                            repoRoot,
                            this.selectedBranch,
                            this.settings.gitTimeout
                        );
                        this.decorator.applyBranchDiffHighlighting(editor, blameResult, diffLines.addedLines);
                        
                        const lineCount = diffLines.addedLines.length;
                        if (lineCount > 0) {
                            vscode.window.setStatusBarMessage(
                                `${lineCount} line${lineCount !== 1 ? 's' : ''} differ from "${this.selectedBranch}"`,
                                3000
                            );
                        } else {
                            vscode.window.setStatusBarMessage(
                                `No differences from "${this.selectedBranch}" in this file`,
                                3000
                            );
                        }
                    }
                    break;
            }

            // Apply gutter annotations if enabled
            if (this.settings.enableGutterAnnotations) {
                this.gutterDecorator.applyAuthorGutter(editor, blameResult, this.settings.gutterDisplayMode);
            } else {
                this.gutterDecorator.clearFromEditor(editor);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Git Spotlight error: ${message}`);
            this.decorator.clearAllFromEditor(editor);
        }
    }

    private handleRepoErrors(repoInfo: GitRepoInfo): boolean {
        if (!repoInfo.gitAvailable) {
            vscode.window.showWarningMessage('Git is not installed or not in PATH.');
            return false;
        }
        if (!repoInfo.isRepository || !repoInfo.headCommit) {
            return false;
        }
        return true;
    }

    /**
     * Update status bar
     */
    private updateStatusBar(): void {
        // Show/hide navigation buttons based on mode
        if (this.mode === 'none') {
            this.prevButton.hide();
            this.nextButton.hide();
        } else {
            this.prevButton.show();
            this.nextButton.show();
        }

        switch (this.mode) {
            case 'none':
                this.statusBarItem.text = '$(telescope) Git Spotlight';
                this.statusBarItem.tooltip = 'Git Spotlight: Click to view options';
                break;
            case 'age':
                this.statusBarItem.text = `$(clock) Age: ${this.parsedDuration?.description ?? this.duration}`;
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
            case 'author':
                this.statusBarItem.text = '$(person) All Authors';
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
            case 'commit':
                this.statusBarItem.text = '$(git-commit) All Commits';
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
            case 'specificAuthor':
                this.statusBarItem.text = `$(person) ${this.selectedAuthor}`;
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
            case 'specificCommit':
                this.statusBarItem.text = `$(git-commit) ${this.selectedCommit?.substring(0, 8)}`;
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
            case 'heatmap':
                this.statusBarItem.text = '$(flame) Heatmap';
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
            case 'branchDiff':
                this.statusBarItem.text = `$(git-compare) vs ${this.selectedBranch}`;
                this.statusBarItem.tooltip = 'Click to clear highlights';
                break;
        }
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.debouncedRefresh.cancel();
        this.decorator.dispose();
        this.gutterDecorator.dispose();
        this.statusBarItem.dispose();
        this.prevButton.dispose();
        this.nextButton.dispose();
        this.gitHeadWatchers.forEach(watcher => watcher.dispose());
        this.disposables.forEach(d => d.dispose());
    }
}

// Global extension instance
let extension: GitSpotlightExtension | undefined;

/**
 * Extension activation point
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('Git Spotlight is now active');

    extension = new GitSpotlightExtension(context.extensionUri);

    // Register commands
    const commands = [
        vscode.commands.registerCommand('gitSpotlight.highlightByAge', () => extension?.highlightByAge()),
        vscode.commands.registerCommand('gitSpotlight.highlightByAuthor', () => extension?.highlightByAuthor()),
        vscode.commands.registerCommand('gitSpotlight.highlightByCommit', () => extension?.highlightByCommit()),
        vscode.commands.registerCommand('gitSpotlight.highlightSpecificAuthor', () => extension?.highlightSpecificAuthor()),
        vscode.commands.registerCommand('gitSpotlight.highlightSpecificCommit', () => extension?.highlightSpecificCommit()),
        vscode.commands.registerCommand('gitSpotlight.highlightBranchDiff', () => extension?.highlightBranchDiff()),
        vscode.commands.registerCommand('gitSpotlight.diffWithBranch', () => extension?.diffWithBranch()),
        vscode.commands.registerCommand('gitSpotlight.highlightHeatmap', () => extension?.highlightHeatmap()),
        vscode.commands.registerCommand('gitSpotlight.showStatistics', () => extension?.showStatistics()),
        vscode.commands.registerCommand('gitSpotlight.toggleGutter', () => extension?.toggleGutter()),
        vscode.commands.registerCommand('gitSpotlight.clear', () => extension?.clear()),
        vscode.commands.registerCommand('gitSpotlight.goToNextHighlight', () => extension?.goToNextHighlight()),
        vscode.commands.registerCommand('gitSpotlight.goToPreviousHighlight', () => extension?.goToPreviousHighlight()),
        // Legacy command for backward compatibility
        vscode.commands.registerCommand('gitSpotlight.toggle', () => {
            if (extension) {
                extension.currentMode === 'none' ? extension.highlightByAge() : extension.clear();
            }
        }),
    ];

    commands.forEach(cmd => context.subscriptions.push(cmd));
    context.subscriptions.push({ dispose: () => extension?.dispose() });
}

/**
 * Extension deactivation point
 */
export function deactivate(): void {
    extension?.dispose();
    extension = undefined;
    console.log('Git Spotlight deactivated');
}
