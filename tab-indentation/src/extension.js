let vscode = require("vscode")

function activate(context) {
	let disposable = vscode.commands.registerTextEditorCommand(
		"collapse-to-tab.fixDocument",
		async (editor) => {
			if (!editor) {
				return
			}

			let doc = editor.document
			let fullText = doc.getText()
			let fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(fullText.length))

			// Replace runs of 4 spaces or 4 tabs with tabs
			let replaced = fullText.replace(/(?: {4})+|(?:\t{4})+/g, (m) => {
				let groups = m.length / 4
				return "\t".repeat(groups)
			})

			if (replaced === fullText) {
				vscode.window.showInformationMessage("Collapse to Tab: No changes needed")
				return
			}

			await editor.edit((editBuilder) => {
				editBuilder.replace(fullRange, replaced)
			})

			vscode.window.showInformationMessage("Collapse to Tab: Document updated")
		}
	)

	context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = { activate, deactivate }