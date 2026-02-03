let vscode = require('vscode')

function activate(context) {
	let disposable = vscode.commands.registerCommand('extension.formatSignatureVertical', function () {
		let editor = vscode.window.activeTextEditor
		if (!editor) return

		let document = editor.document
		let selection = editor.selection
		
		let lineIndex = selection.active.line
		let line = document.lineAt(lineIndex)
		let text = line.text

		// Regex breakdown:
		// Group 1: Leading indentation (tabs/spaces)
		// Group 2: The actual method text up to '('
		// Group 3: The arguments inside the parens
		// Group 4: The closing ')' and optional '{'
		let regex = /^(\s*)(.*?\()([^)]*)(\)\s*\{?)$/
		let match = text.match(regex)

		if (match) {
			let indent = match[1]        // Existing indentation level
			let methodText = match[2]    // public static void SolvesContext_AddSolve(
			let argsContent = match[3]   // string scramble, double time...
			let suffix = match[4]        // ) {

			let argsArray = argsContent.split(',')
				.map(arg => arg.trim())
				.filter(arg => arg.length > 0)

			// THE FIX: Take the existing indent and add exactly ONE tab for the args
			let formattedArgs = argsArray.map(arg => `${indent}\t${arg}`).join(',\n')

			let closingParen = `${indent})`
			let brace = suffix.includes('{') ? `\n${indent}{` : ''

			// Combine: [Indent][MethodName(]\n[Indent+Tab][Args]\n[Indent][)]\n[Indent][{]
			let result = `${indent}${methodText}\n${formattedArgs}\n${closingParen}${brace}`

			editor.edit(editBuilder => {
				editBuilder.replace(line.range, result)
			})
		}
	})

	context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}