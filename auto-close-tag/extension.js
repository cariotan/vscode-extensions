const vscode = require('vscode');

/**
	* State-machine parser that determines if the '>' at the end of `text`
	* is genuinely closing an HTML/JSX/Component opening tag.
	* 
	* Returns the tagName if valid, or null if '>' was typed inside a string,
	* expression, comment, comparison, or arrow function.
	*/
function parseOpeningTag(text)
{
	// Must end with the '>' we just typed, and not be '/>' or '=>'
	if(!text.endsWith('>') || text.endsWith('/>') || text.endsWith('=>')) return null;

	// Scan backwards from just before the final '>' to find candidate '<' positions
	for(let i = text.length - 2; i >= 0; i--)
	{
		if(text[i] === '<')
		{
			const slice = text.slice(i);

			// Check if this '<' starts with a valid tag name (HTML, Vue, React, etc.)
			const tagMatch = slice.match(/^<([a-zA-Z][a-zA-Z0-9\-_:\.]*)(?=[\s/>])/);
			if(!tagMatch) continue;

			const tagName = tagMatch[1];

			// Now walk forward from after `<tagName` to the final `>` using a state machine
			let inQuote = null; // null, '"', "'", or '`'
			let braceDepth = 0; // Tracks { } depth outside of quotes
			let parenDepth = 0; // Tracks ( ) depth outside of quotes
			let hitUnquotedClose = false;

			for(let j = tagMatch[0].length; j < slice.length - 1; j++)
			{
				const ch = slice[j];
				const prev = slice[j - 1];

				if(inQuote)
				{
					// Inside a string: ignore EVERYTHING until the matching closing quote
					if(ch === inQuote && prev !== '\\')
					{
						inQuote = null;
					}
				}
				else
				{
					// Outside of strings:
					if(ch === '"' || ch === "'" || ch === '`')
					{
						inQuote = ch;
					}
					else if(ch === '{')
					{
						braceDepth++;
					}
					else if(ch === '}')
					{
						if(braceDepth > 0) braceDepth--;
					}
					else if(ch === '(')
					{
						parenDepth++;
					}
					else if(ch === ')')
					{
						if(parenDepth > 0) parenDepth--;
					}
					else if(ch === '>' && braceDepth === 0 && parenDepth === 0)
					{
						// If we hit a top-level '>' BEFORE the end of the text,
						// then this '<' was already closed earlier!
						hitUnquotedClose = true;
						break;
					}
				}
			}

			// If this '<' was already closed earlier on the page, stop searching backwards.
			if(hitUnquotedClose)
			{
				return null;
			}

			// If we reached the final '>' and we are NOT inside an unclosed quote, brace, or paren:
			if(!inQuote && braceDepth === 0 && parenDepth === 0)
			{
				return tagName;
			}

			// Otherwise we are inside an unclosed quote/brace/paren. Do nothing!
			return null;
		}
	}

	return null;
}

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
		// Get text from up to 50 lines above the cursor to handle large multi-line tags/props
		const startLine = Math.max(0, position.line - 50);
		const range = new vscode.Range(new vscode.Position(startLine, 0), position.translate(0, 1));
		const textBefore = editor.document.getText(range);

		const tagName = parseOpeningTag(textBefore);

		if(tagName)
		{
			// If the tag is in the excluded list (like 'input' or 'img'), do nothing.
			if(excludedTags.includes(tagName.toLowerCase())) return;

			// Position right after the '>' that was just typed
			const insertPos = position.translate(0, 1);

			// Use editor.edit instead of insertSnippet so VSCodeVim doesn't jump to the end on <Esc>
			editor.edit(editBuilder =>
			{
				editBuilder.insert(insertPos, `</${tagName}>`);
			}, {
				undoStopBefore: false,
				undoStopAfter: false
			}).then(success =>
			{
				if(success)
				{
					// Explicitly anchor the cursor right after '>' (between the opening and closing tags)
					editor.selection = new vscode.Selection(insertPos, insertPos);
				}
			});
		}
	});

	context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = { activate, deactivate };