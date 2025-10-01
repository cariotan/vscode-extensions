let vscode = require("vscode")

let applyingEdit = false

function activate(context) {
	let sub = vscode.commands.registerTextEditorCommand(
		"collapse-to-tab.fixDocument",
		fixWholeDocument
	)
	context.subscriptions.push(sub)
}

async function fixWholeDocument(editor) {
	let doc = editor.document
	let text = doc.getText()
	let fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length))

	let replaced = text.replace(/\t{4}/g, "\t")
	replaced = replaced.replace(/ {4}/g, "\t")

	if (replaced === text) {
		return
	}

	applyingEdit = true
	await editor.edit(edit => {
		edit.replace(fullRange, replaced)
	})
	applyingEdit = false
}

function deactivate() {}

module.exports = { activate, deactivate }