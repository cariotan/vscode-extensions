const vscode = require('vscode')

function activate(context)
{
	const output = vscode.window.createOutputChannel('C# Auto Using')
	output.appendLine('[Init] C# Auto Using activated.')

	let timeout
	let isApplying = false

	function scheduleCheck(editor, source)
	{
		if(!editor || editor.document.languageId !== 'csharp')
		{
			return
		}
		clearTimeout(timeout)
		timeout = setTimeout(() =>
		{
			autoImportMissingUsings(editor, output, source)
		}, 350)
	}

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(() =>
		{
			scheduleCheck(vscode.window.activeTextEditor, 'onDidChangeDiagnostics')
		}),
		vscode.window.onDidChangeTextEditorSelection((event) =>
		{
			scheduleCheck(event.textEditor, 'onDidChangeTextEditorSelection')
		})
	)

	async function autoImportMissingUsings(editor, output, source)
	{
		if(isApplying)
		{
			return
		}

		const doc = editor.document
		const allDiagnostics = vscode.languages.getDiagnostics(doc.uri)
		const targetCodes = new Set(['CS0246', 'CS0103', 'CS1061'])

		const missingDiagnostics = allDiagnostics.filter((d) =>
		{
			const rawCode = typeof d.code === 'object' && d.code !== null ? d.code.value : d.code
			const codeStr = String(rawCode || '')
			return (
				targetCodes.has(codeStr) ||
				d.message.includes('could not be found') ||
				d.message.includes('does not exist in the current context')
			)
		})

		if(missingDiagnostics.length === 0)
		{
			return
		}

		isApplying = true
		try
		{
			for(const diag of missingDiagnostics)
			{
				const cursor = editor.selection.active
				const diagPos = `L${diag.range.start.line}:${diag.range.start.character}`

				if(diag.range.contains(cursor) || diag.range.end.isEqual(cursor))
				{
					continue
				}


				const actions = await vscode.commands.executeCommand(
					'vscode.executeCodeActionProvider',
					doc.uri,
					diag.range,
					vscode.CodeActionKind.QuickFix.value,
					100
				)

				if(!actions || actions.length === 0)
				{
					continue
				}

				for(const a of actions)
				{
					const editEntries = a.edit ? a.edit.entries().length : 0
					const cmdName = a.command ? a.command.command : 'none'
				}

				const usingActions = actions.filter((a) =>
					/^(add\s+)?using\s+[\w.]+/i.test(a.title.trim())
				)

				if(usingActions.length === 0)
				{
					continue
				}

				const chosenAction =
					usingActions.find((a) => a.isPreferred) ||
					usingActions[0]

				if(chosenAction.edit)
				{
					const applied = await vscode.workspace.applyEdit(chosenAction.edit)
				}

				if(chosenAction.command)
				{
					await vscode.commands.executeCommand(
						chosenAction.command.command,
						...(chosenAction.command.arguments || [])
					)
				}

				if(!chosenAction.edit && !chosenAction.command)
				{
				}

				break
			}
		}
		catch(err)
		{
			output.appendLine(`[Error] ${err.stack || err.message || err}`)
		}
		finally
		{
			isApplying = false
		}
	}
}

function deactivate()
{
}

module.exports = { activate, deactivate }