const vscode = require("vscode")

let applyingEdit = false

function activate(context) {
	const sub1 = vscode.workspace.onDidChangeTextDocument(onDocChange)
	const sub2 = vscode.commands.registerTextEditorCommand("collapse-to-tab.fixDocument", fixWholeDocument)
	context.subscriptions.push(sub1, sub2)
}

function onDocChange(e) {
	if (applyingEdit) return

	const editor = vscode.window.activeTextEditor
	if (!editor) return
	if (e.document.uri.toString() !== editor.document.uri.toString()) return

	for (let i = 0; i < e.contentChanges.length; i++) {
		const change = e.contentChanges[i]
		if (change.text.length === 0) continue

		const endPos = change.range.start.translate(0, change.text.length)
		const startChar = Math.max(0, endPos.character - 4)
		const startPos = new vscode.Position(endPos.line, startChar)
		const last4Range = new vscode.Range(startPos, endPos)
		const last4 = e.document.getText(last4Range)

		if (last4 === "    " || last4 === "\t\t\t\t") {
			applyingEdit = true
			editor.edit(edit => {
				edit.replace(last4Range, "\t")
			}).finally(() => {
				applyingEdit = false
			})
		}
	}
}

async function fixWholeDocument(editor) {
	const doc = editor.document
	const text = doc.getText()
	const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length))

	let replaced = text.replace(/\t{4}/g, "\t")
	replaced = replaced.replace(/ {4}/g, "\t")

	if (replaced === text) return

	applyingEdit = true
	await editor.edit(edit => {
		edit.replace(fullRange, replaced)
	})
	applyingEdit = false
}

function deactivate() { }

module.exports = { activate, deactivate }