const vscode = require('vscode');

function activate(context) {
	let disposable = vscode.commands.registerCommand('html-attribute-stacker.stack', function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const document = editor.document;
		const position = editor.selection.active;
		const lineText = document.lineAt(position.line).text;

		const tagRegex = /<([a-zA-Z0-9\-]+)([^>]*)>(.*?)(<\/\1>)?/g;
		let match;
		let targetMatch = null;

		while ((match = tagRegex.exec(lineText)) !== null) {
			const start = match.index;
			const end = start + match[0].length;
			if (position.character >= start && position.character <= end) {
				targetMatch = match;
				break;
			}
		}

		if (!targetMatch) {
			vscode.window.showInformationMessage('No HTML tag found at cursor on this line.');
			return;
		}

		const fullMatch = targetMatch[0];
		const tagName = targetMatch[1];
		let attributesString = targetMatch[2];
		const innerContent = targetMatch[3] || "";
		const closingTag = targetMatch[4] || "";

		const isSelfClosing = attributesString.trim().endsWith('/');
		if (isSelfClosing) {
			attributesString = attributesString.replace(/\/$/, '');
		}

		const baseIndent = lineText.match(/^\s*/)[0];
		const attrIndent = baseIndent + '\t';

		const attrRegex = /([^\s=]+)(?:=(["'])(.*?)\2)?/g;
		let attrMatch;
		const valuelessAttrs = [];
		const valueAttrs = [];

		while ((attrMatch = attrRegex.exec(attributesString)) !== null) {
			const attrName = attrMatch[1];
			const hasValue = attrMatch[2] !== undefined;
			if (hasValue) {
				valueAttrs.push(attrMatch[0]);
			} else {
				valuelessAttrs.push(attrName);
			}
		}

		let formatted = `<${tagName}`;
		if (valuelessAttrs.length > 0) {
			formatted += ` ${valuelessAttrs.join(' ')}`;
		}

		if (valueAttrs.length > 0) {
			valueAttrs.forEach(attr => {
				formatted += `\n${attrIndent}${attr}`;
			});
			// Drops the closing > down to a new line matching the tag's base indentation
			formatted += `\n${baseIndent}${isSelfClosing ? '/>' : '>'}`;
		} else {
			formatted += isSelfClosing ? ' />' : '>';
		}

		if (innerContent || closingTag) {
			formatted += `\n${attrIndent}${innerContent}${closingTag}`;
		}

		const startPos = new vscode.Position(position.line, targetMatch.index);
		const endPos = new vscode.Position(position.line, targetMatch.index + fullMatch.length);
		const range = new vscode.Range(startPos, endPos);

		editor.edit(editBuilder => {
			editBuilder.replace(range, formatted);
		});
	});

	context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};