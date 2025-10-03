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
      .replace(/>\s*<(?!\/)/g, ">\n<")
      .split("\n")
      .map(l => l.trimEnd())
      .join("\n")

    await editor.edit(edit => edit.replace(targetRange, transformed));
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
