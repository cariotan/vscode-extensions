const vscode = require('vscode');

function activate(context)
{
	let disposable = vscode.commands.registerCommand('extension.formatSignatureVertical', function ()
	{
		const editor = vscode.window.activeTextEditor;
		if(!editor) return;

		const document = editor.document;
		const selection = editor.selection;
		const line = document.lineAt(selection.active.line);
		const text = line.text;

		const firstParen = text.indexOf('(');
		const lastParen = text.lastIndexOf(')');

		// Only run if both parens exist on this line
		if(firstParen !== -1 && lastParen !== -1 && lastParen > firstParen)
		{
			// 1. Get the original indentation (spaces/tabs at start of line)
			const indentMatch = text.match(/^\s*/);
			const indent = indentMatch ? indentMatch[0] : '';

			// 2. Break the line into three parts
			const prefix = text.substring(0, firstParen + 1);      // Everything up to "("
			const argsContent = text.substring(firstParen + 1, lastParen); // Everything inside "()"
			const suffix = text.substring(lastParen);             // Everything from ")" onwards

			// 3. Clean up the arguments
			const argsArray = argsContent.split(',')
				.map(arg => arg.trim())
				.filter(arg => arg.length > 0);

			// 4. Format: Indent each arg with the base indent + 1 tab
			const formattedArgs = argsArray.map(arg => `${indent}\t${arg}`).join(',\n');

			// 5. Build the final block
			// Result:
			// Prefix (
			//     arg1,
			//     arg2
			// ) Suffix
			const result = `${prefix}\n${formattedArgs}\n${indent}${suffix}`;

			editor.edit(editBuilder =>
			{
				editBuilder.replace(line.range, result);
			});
		}
	});

	context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};