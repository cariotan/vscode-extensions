const vscode = require('vscode');

/**
 * Splits a string by commas, ignoring commas inside brackets, parens, generics, and quotes.
 */
function splitTopLevelArgs(str) {
	const result = [];
	let current = '';
	let depthParen = 0;   // ()
	let depthBracket = 0; // []
	let depthBrace = 0;   // {}
	let depthAngle = 0;   // <>
	let inQuote = false;
	let quoteChar = '';

	for (let i = 0; i < str.length; i++) {
		const char = str[i];

		// 1. Handle string literals (ignore escaped quotes)
		if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
			if (!inQuote) {
				inQuote = true;
				quoteChar = char;
			} else if (char === quoteChar) {
				inQuote = false;
			}
		}

		// 2. If not in a string, track bracket depths
		if (!inQuote) {
			if (char === '(') depthParen++;
			else if (char === ')') depthParen = Math.max(0, depthParen - 1);
			else if (char === '[') depthBracket++;
			else if (char === ']') depthBracket = Math.max(0, depthBracket - 1);
			else if (char === '{') depthBrace++;
			else if (char === '}') depthBrace = Math.max(0, depthBrace - 1);
			else if (char === '<') depthAngle++;
			else if (char === '>') depthAngle = Math.max(0, depthAngle - 1);

			// 3. Split ONLY if we hit a comma at the top level
			if (char === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0 && depthAngle === 0) {
				result.push(current.trim());
				current = '';
				continue;
			}
		}

		current += char;
	}

	if (current.trim().length > 0) {
		result.push(current.trim());
	}

	return result;
}

function activate(context) {
	let disposable = vscode.commands.registerCommand('extension.formatSignatureVertical', function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const document = editor.document;
		const selection = editor.selection;
		const line = document.lineAt(selection.active.line);
		const text = line.text;

		const firstParen = text.indexOf('(');
		const lastParen = text.lastIndexOf(')');

		// Only run if both parens exist on this line
		if (firstParen !== -1 && lastParen !== -1 && lastParen > firstParen) {
			// 1. Get the original indentation
			const indentMatch = text.match(/^\s*/);
			const indent = indentMatch ? indentMatch[0] : '';

			// 2. Break the line into three parts
			const prefix = text.substring(0, firstParen + 1);
			const argsContent = text.substring(firstParen + 1, lastParen);
			const suffix = text.substring(lastParen);

			// 3. Clean up the arguments using the smart splitter
			const argsArray = splitTopLevelArgs(argsContent);

			if (argsArray.length === 0) return; // Nothing to format

			// 4. Format: Indent each arg with the base indent + 1 tab
			const formattedArgs = argsArray.map(arg => `${indent}\t${arg}`).join(',\n');

			// 5. Build the final block
			const result = `${prefix}\n${formattedArgs}\n${indent}${suffix}`;

			editor.edit(editBuilder => {
				editBuilder.replace(line.range, result);
			});
		}
	});

	context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};