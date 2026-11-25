const vscode = require('vscode')

function toCamelCase(str)
{
	return str.charAt(0).toLowerCase() + str.slice(1)
}

function stripCommentsAndStrings(line)
{
	return line
		.replace(/\/\/.*$/, '')
		.replace(/"(?:\\.|[^"\\])*"/g, '')
		.replace(/'(?:\\.|[^'\\])*'/g, '')
}

function findEnclosingClass(lines, cursorLine)
{
	const classRegex = /\b(?:class|record|struct)\s+\w+/
	const classStack = []
	const completedClasses = []
	let braceDepth = 0
	let pendingClassStart = null

	for(let i = 0; i < lines.length; i++)
	{
		const cleanLine = stripCommentsAndStrings(lines[i])

		if(classRegex.test(cleanLine))
		{
			pendingClassStart = i
		}

		for(let j = 0; j < cleanLine.length; j++)
		{
			const ch = cleanLine[j]

			if(ch === '{')
			{
				braceDepth++
				if(pendingClassStart !== null)
				{
					classStack.push({
						startLine: pendingClassStart,
						openBraceLine: i,
						depth: braceDepth
					})
					pendingClassStart = null
				}
			}
			else if(ch === '}')
			{
				if(classStack.length > 0 && classStack[classStack.length - 1].depth === braceDepth)
				{
					const cls = classStack.pop()
					cls.endLine = i
					completedClasses.push(cls)
				}
				braceDepth = Math.max(0, braceDepth - 1)
			}
		}
	}

	const matches = completedClasses.filter(function(cls)
	{
		return cursorLine >= cls.startLine && cursorLine <= cls.endLine
	})

	if(matches.length === 0)
	{
		return null
	}

	matches.sort(function(a, b)
	{
		return b.depth - a.depth
	})

	return matches[0]
}

function activate(context)
{
	const disposable = vscode.commands.registerCommand('jsonPropertyAdder.addAttributes', function()
	{
		const editor = vscode.window.activeTextEditor
		if(!editor)
		{
			return
		}

		const document = editor.document
		const cursorLine = editor.selection.active.line
		const lines = document.getText().split(/\r?\n/)
		const targetClass = findEnclosingClass(lines, cursorLine)

		if(!targetClass)
		{
			vscode.window.showInformationMessage('Cursor is not inside a class, record, or struct.')
			return
		}

		const propRegex = /^(\s*)(?:public|private|protected|internal)\s+(?:(?:static|virtual|override|required|new)\s+)*[\w<>\[\]\?,\s]+\s+(\w+)\s*\{\s*get;/
		const newLines = []
		let braceDepth = 0
		let addedCount = 0

		for(let i = 0; i < lines.length; i++)
		{
			const line = lines[i]
			const cleanLine = stripCommentsAndStrings(line)
			const inTargetRange = i >= targetClass.openBraceLine && i <= targetClass.endLine

			if(inTargetRange && braceDepth === targetClass.depth)
			{
				const match = line.match(propRegex)
				if(match)
				{
					const prevLine = i > 0 ? lines[i - 1].trim() : ''
					if(!prevLine.includes('[JsonPropertyName('))
					{
						if(addedCount > 0 && newLines.length > 0 && newLines[newLines.length - 1].trim() !== '')
						{
							newLines.push('')
						}

						const indent = match[1]
						const propName = match[2]
						const jsonName = toCamelCase(propName)
						newLines.push(`${indent}[JsonPropertyName("${jsonName}")]`)
						addedCount++
					}
				}
			}

			newLines.push(line)

			for(let j = 0; j < cleanLine.length; j++)
			{
				if(cleanLine[j] === '{')
				{
					braceDepth++
				}
				else if(cleanLine[j] === '}')
				{
					braceDepth = Math.max(0, braceDepth - 1)
				}
			}
		}

		if(addedCount === 0)
		{
			vscode.window.showInformationMessage('No eligible properties found in the current class.')
			return
		}

		const fullText = newLines.join('\n')
		const hasUsing = /using\s+System\.Text\.Json\.Serialization;/.test(fullText)
		const finalOutput = hasUsing ? fullText : 'using System.Text.Json.Serialization;\n' + fullText

		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(document.getText().length)
		)

		editor.edit(function(editBuilder)
		{
			editBuilder.replace(fullRange, finalOutput)
		})

		vscode.window.showInformationMessage(`Added ${addedCount} JsonPropertyName attribute(s).`)
	})

	context.subscriptions.push(disposable)
}

function deactivate()
{
}

module.exports =
{
	activate,
	deactivate
}