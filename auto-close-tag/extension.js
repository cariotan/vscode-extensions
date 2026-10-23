const vscode = require('vscode');

function activate(context)
{
	let disposable = vscode.workspace.onDidChangeTextDocument(event =>
	{
		if(!event.contentChanges.length) return;

		const change = event.contentChanges[0];

		// STRICTLY only trigger when '>' is typed. 
		// Typing '/' will NEVER do anything.
		if(change.text !== '>') return;

		const editor = vscode.window.activeTextEditor;
		if(!editor || editor.document !== event.document) return;

		// Fetch configuration
		const config = vscode.workspace.getConfiguration('pureAutoCloseTag');
		
		// Check if the current language is supported via settings
		const lang = editor.document.languageId;
		const supportedLangs = config.get('supportedLanguages') || [];
		
		// Allow '*' as a wildcard if the user wants it enabled in all languages
		if(!supportedLangs.includes(lang) && !supportedLangs.includes('*')) return;

		const excludedTags = config.get('excludedTags') || [];

		const position = change.range.start;
		// Get text from up to 20 lines above the cursor to handle multi-line tags/props
		const startLine = Math.max(0, position.line - 20);
		const range = new vscode.Range(new vscode.Position(startLine, 0), position.translate(0, 1));
		const textBefore = editor.document.getText(range);

		// Regex breakdown:
		// <([a-zA-Z0-9\-_:\.]+) -> Matches "<" followed by the tag name (Supports HTML, React, Vue)
		// (?:\s+[^>]*)?         -> Matches optional attributes/spaces inside the tag
		// >$                    -> Must end with the ">" you just typed
		const match = textBefore.match(/<([a-zA-Z0-9\-_:\.]+)(?:\s+[^>]*)?>$/);

		if(match)
		{
			const fullMatch = match[0];
			const tagName = match[1];

			// 1. If the user manually typed "/>", do nothing.
			if(fullMatch.endsWith('/>')) return;

			// 2. If the tag is in the excluded list (like 'input' or 'img'), do nothing.
			if(excludedTags.includes(tagName.toLowerCase())) return;

			// Insert the closing tag and keep the cursor in the middle
			const insertPos = position.translate(0, 1);
			editor.insertSnippet(new vscode.SnippetString(`$0</${tagName}>`), insertPos, {
				undoStopBefore: false,
				undoStopAfter: false
			});
		}
	});

	context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = { activate, deactivate };