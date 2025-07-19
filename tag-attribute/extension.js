// extension.js
const vscode = require('vscode')

function activate(context) {
	const disposable = vscode.commands.registerCommand('attributeFormatter.formatSvgTag', () => {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		const document = editor.document
		const text = document.getText()

		const formattedText = formatSvgTags(text)
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		)

		editor.edit(editBuilder => {
			editBuilder.replace(fullRange, formattedText)
		})
	})

	context.subscriptions.push(disposable)
}

function formatSvgTags(text) {
	const svgRegex = /<svg\s+([^>]+)>/g
	return text.replace(svgRegex, (match, attrs) => {
		const attrRegex = /([\w:-]+)=['"]([^'"]*)['"]/g
		let parts = []
		let m

		while ((m = attrRegex.exec(attrs)) !== null) {
			parts.push(`${m[1]}='${m[2]}'`)
		}

		if (parts.length <= 1) return match

		const [first, ...rest] = parts
		const formattedAttrs = rest.map(attr => `  ${attr}`).join('\n')
		return `<svg ${first}\n${formattedAttrs}>`
	})
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
} 
