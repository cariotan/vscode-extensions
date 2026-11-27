// extension.js
// VS Code extension entry that formats <svg> opening tags whose attributes are on a single line,
// rewriting them so each attribute is on its own line, indented by one extra tab,
// and the final '>' (or '/>') is aligned with the <svg> tag's indentation.

const vscode = require('vscode');

/**
 * Convert a single-line <svg ...> opening tag into:
 *
 * <svg
 * 	attr1="..."
 * 	attr2="..."
 * >
 *
 * ...with the closing bracket aligned to the original <svg> indentation.
 */
function reformatSvgOpenTags(text) {
	// Regex to capture indentation and the opening <svg ...> up to the closing '>' (not including any inner content)
	//   1: leading indentation (spaces/tabs)
	//   2: everything after 'svg' up to before '>'
	// Supports attributes (possibly including '/'), but we'll only process matches where group 2 has no newline.
	const svgOpenTagRegex = /(^[ \t]*)<svg\b([^>]*?)>/gim;

	const attrRegex = /([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

	return text.replace(svgOpenTagRegex, (full, indent, inside) => {
		// If attributes already span multiple lines, skip (the user asked for single-line only).
		if (/\r?\n/.test(inside)) {
			return full;
		}

		let inner = inside;

		// Detect self-closing (e.g., '<svg ... />')
		let isSelfClosing = /\/\s*$/.test(inner);
		if (isSelfClosing) {
			// Remove the trailing slash from the attribute string; we'll add '/>' on its own line later.
			inner = inner.replace(/\/\s*$/, '');
		}

		// Gather attributes in order
		const attrs = [];
		let m;
		while ((m = attrRegex.exec(inner)) !== null) {
			const name = m[1];
			const eqAndVal = m[2] || '';
			attrs.push(name + eqAndVal);
		}

		// If there are no attributes, leave as-is.
		if (attrs.length === 0) {
			return full;
		}

		const attrIndent = indent + '\t'; // one extra tab
		const closing = isSelfClosing ? '/>' : '>';

		const lines = [];
		lines.push(`${indent}<svg`);
		for (const a of attrs) {
			const cleaned = a.trim();
			if (cleaned.length) {
	lines.push(`${attrIndent}${cleaned}`);
			}
		}
		lines.push(`${indent}${closing}`);

		return lines.join('\n');
	});
}

function activate(context) {
	// Register using the requested command ID
	const disposable = vscode.commands.registerCommand('attributeFormatter.formatSvgTag', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('Open an editor to format SVG tags.');
			return;
		}

		const doc = editor.document;
		const fullRange = new vscode.Range(
			doc.positionAt(0),
			doc.positionAt(doc.getText().length)
		);

		const original = doc.getText();
		const updated = reformatSvgOpenTags(original);

		if (updated === original) {
			vscode.window.showInformationMessage('No single-line <svg> opening tags found to reformat.');
			return;
		}

		const ok = await editor.edit((editBuilder) => {
			editBuilder.replace(fullRange, updated);
		});

		if (!ok) {
			vscode.window.showErrorMessage('Failed to apply SVG attribute formatting.');
		}
	});

	context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
