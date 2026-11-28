const vscode = require('vscode')

function activate(context)
{
	const disposable = vscode.window.onDidStartTerminalShellExecution(async e =>
	{
		const stream = e.execution.read()
		for await(const data of stream)
		{
			if(data.includes('Exception') || data.includes('error'))
			{
				e.terminal.show(true)
			}
		}
	})

	context.subscriptions.push(disposable)
}

module.exports = { activate }