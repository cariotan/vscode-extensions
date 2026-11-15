const vscode = require('vscode');

function activate(context) {
	const output = vscode.window.createOutputChannel('C# Auto Using');
	output.appendLine('C# Auto Using activated.');

	let timeout;
	let isApplying = false;

	function scheduleCheck(editor) {
		if (!editor || editor.document.languageId !== 'csharp') {
			return;
		}
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			autoImportMissingUsings(editor, output);
		}, 300);
	}

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(() => {
			scheduleCheck(vscode.window.activeTextEditor);
		}),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			scheduleCheck(event.textEditor);
		})
	);

	async function autoImportMissingUsings(editor, output) {
		if (isApplying) {
			return;
		}

		const doc = editor.document;
		const allDiagnostics = vscode.languages.getDiagnostics(doc.uri);
		const targetCodes = new Set(['CS0246', 'CS0103', 'CS1061']);

		const missingDiagnostics = allDiagnostics.filter((d) => {
			const rawCode = typeof d.code === 'object' && d.code !== null ? d.code.value : d.code;
			const codeStr = String(rawCode || '');
			return (
				targetCodes.has(codeStr) ||
				d.message.includes('could not be found') ||
				d.message.includes('does not exist in the current context')
			);
		});

		if (missingDiagnostics.length === 0) {
			return;
		}

		isApplying = true;
		try {
			for (const diag of missingDiagnostics) {
				const cursor = editor.selection.active;

				if (diag.range.contains(cursor) || diag.range.end.isEqual(cursor)) {
					continue;
				}

				const actions = await vscode.commands.executeCommand(
					'vscode.executeCodeActionProvider',
					doc.uri,
					diag.range,
					vscode.CodeActionKind.QuickFix.value,
					10
				);

				if (!actions || actions.length === 0) {
					continue;
				}

				const usingActions = actions.filter((a) =>
					/^(add\s+)?using\s+[\w.]+\s*;?$/i.test(a.title.trim())
				);

				if (usingActions.length === 0) {
					continue;
				}

				// Pick the action Roslyn marks as preferred, or its top-ranked suggestion
				const chosenAction =
					usingActions.find((a) => a.isPreferred) || usingActions[0];

				output.appendLine(`Applying: ${chosenAction.title}`);

				if (chosenAction.edit) {
					await vscode.workspace.applyEdit(chosenAction.edit);
				}

				if (chosenAction.command) {
					await vscode.commands.executeCommand(
						chosenAction.command.command,
						...(chosenAction.command.arguments || [])
					);
				}

				break;
			}
		} catch (err) {
			output.appendLine(`Error: ${err.message || err}`);
		} finally {
			isApplying = false;
		}
	}
}

function deactivate() {}

module.exports = { activate, deactivate };