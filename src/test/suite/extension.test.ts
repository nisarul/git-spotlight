/**
 * Extension Integration Tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration Tests', () => {
    vscode.window.showInformationMessage('Starting Git Age Highlighter tests.');

    test('Extension should be present', () => {
        assert.ok(
            vscode.extensions.getExtension('your-publisher-name.git-age-highlighter'),
            'Extension should be registered'
        );
    });

    test('Toggle command should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('gitAgeHighlighter.toggle'),
            'Toggle command should be registered'
        );
    });

    test('Configuration settings should have defaults', () => {
        const config = vscode.workspace.getConfiguration('gitAgeHighlighter');
        
        assert.strictEqual(config.get('duration'), '30d');
        assert.strictEqual(config.get('enableUncommittedHighlight'), true);
        assert.strictEqual(config.get('maxFileSizeKB'), 1024);
        assert.strictEqual(config.get('highlightColor'), 'rgba(255,165,0,0.25)');
    });
});
