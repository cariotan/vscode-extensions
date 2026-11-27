const vscode = require('vscode');

function activate(context) {
  // One big function, because it’s unlikely we’ll reuse the inner bits elsewhere.
  const disposable = vscode.commands.registerCommand('htmlTagNewline.format', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const doc = editor.document;
    const sel = editor.selection;

    // Work on the selection if it exists, otherwise the whole file.
    const targetRange = sel.isEmpty
      ? new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length))
      : sel;

    const original = doc.getText(targetRange);

    // Very simple heuristic:
    //   1. Insert a newline anywhere we see '><' (tag boundary).
    //   2. Collapse any accidental whitespace around that boundary.
    //   3. Trim trailing spaces per line so we don’t leave junk behind.
   const transformed = original
	// newline between adjacent tags on same line
	.replace(/>(?=\s*<)/g, ">\n")
	// newline after a tag if same-line text follows
	.replace(/>(?=[ \t]*[^<\s])/g, ">\n")
	// newline before a closing tag if same-line text precedes
	.replace(/([^\n>\s])[ \t]*(?=<\/)/g, "$1\n")
	// keep empty pairs like <div></div> on one line
	.replace(/<([A-Za-z][-\w]*)([^>]*)>\s*\n\s*<\/\1>/g, "<$1$2></$1>")
	// normalize line endings
	.replace(/\r\n/g, "\n")

// remove whitespace-only lines and trim trailing spaces per line
let out = []
const lines = transformed.split("\n")
for (let i = 0; i < lines.length; i++) {
	const trimmedEnd = lines[i].replace(/[ \t]+$/g, "")
	if (trimmedEnd.replace(/[ \t]/g, "").length === 0) {
		continue
	}
	out.push(trimmedEnd)
}
const result = out.join("\n")

    await editor.edit(edit => edit.replace(targetRange, transformed));
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
