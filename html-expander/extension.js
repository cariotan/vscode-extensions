let vscode = require('vscode')

function activate(context)
{
	let disposable = vscode.commands.registerCommand('html-expander.expandTag', function ()
	{
		let editor = vscode.window.activeTextEditor
		if (!editor)
		{
			return
		}

		let document = editor.document
		let position = editor.selection.active
		
		// Regex to find the full tag on a single line
		let tagRegex = /<(?<tag>[a-zA-Z0-9]+)(?<attrs>[^>]*)>(?<content>.*)<\/\k<tag>>/
		let range = document.getWordRangeAtPosition(position, tagRegex)

		if (range)
		{
			let text = document.getText(range)
			let match = tagRegex.exec(text)

			if (match)
			{
				// Get the current line's text to find its leading whitespace
				let line = document.lineAt(range.start.line)
				let indentMatch = line.text.match(/^\s*/)
				let currentIndent = indentMatch ? indentMatch[0] : ''

				// Construct the new block:
				// Line 1: The opening tag (already correctly placed)
				// Line 2: Current indent + 1 tab + content
				// Line 3: Current indent + closing tag
				let expanded = '<' + match.groups.tag + match.groups.attrs + '>\n' + 
					currentIndent + '\t' + match.groups.content.trim() + '\n' + 
					currentIndent + '</' + match.groups.tag + '>'
				
				editor.edit(function (editBuilder)
				{
					editBuilder.replace(range, expanded)
				})
			}
		}
	})

	context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}