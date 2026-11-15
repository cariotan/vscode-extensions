const vscode = require('vscode');

function findBalancedDelimiter(str, startIndex, openChar, closeChar)
{
	let depth = 0;
	for(let i = startIndex; i < str.length; i++)
	{
		if(str[i] === openChar)
		{
			depth++;
		}
		else if(str[i] === closeChar)
		{
			depth--;
			if(depth === 0)
			{
				return i;
			}
		}
	}
	return -1;
}

function findLastPropertyEnd(classBodyContent)
{
	let depth = 0;
	let memberStart = 0;
	let lastPropEnd = -1;

	for(let i = 0; i < classBodyContent.length; i++)
	{
		const ch = classBodyContent[i];
		if(ch === '{')
		{
			depth++;
		}
		else if(ch === '}')
		{
			depth--;
			if(depth === 0)
			{
				const memberText = classBodyContent.slice(memberStart, i + 1);
				if(!memberText.includes('(') && /\b(get|set|init)\b/.test(memberText))
				{
					let endIdx = i + 1;
					if(classBodyContent.slice(endIdx).match(/^\s*=/))
					{
						const semi = classBodyContent.indexOf(';', endIdx);
						if(semi !== -1)
						{
							endIdx = semi + 1;
							i = semi;
						}
					}
					lastPropEnd = endIdx;
				}
				memberStart = i + 1;
			}
		}
		else if(ch === ';' && depth === 0)
		{
			const memberText = classBodyContent.slice(memberStart, i + 1);
			if(!memberText.includes('(') && memberText.includes('=>'))
			{
				lastPropEnd = i + 1;
			}
			memberStart = i + 1;
		}
	}

	if(lastPropEnd !== -1)
	{
		while(lastPropEnd < classBodyContent.length && (classBodyContent[lastPropEnd] === ' ' || classBodyContent[lastPropEnd] === '\t'))
		{
			lastPropEnd++;
		}
		if(classBodyContent[lastPropEnd] === '\r')
		{
			lastPropEnd++;
		}
		if(classBodyContent[lastPropEnd] === '\n')
		{
			lastPropEnd++;
		}
	}

	return lastPropEnd;
}

function parsePrimaryConstructor(text)
{
	const headerRegex = /\b(class|struct)\s+([A-Za-z_]\w*(?:<[^>]+>)?)\s*\(/;
	const match = headerRegex.exec(text);
	if(!match)
	{
		return null;
	}

	const fullClassName = match[2];
	const ctorName = fullClassName.replace(/<.*>$/, '');
	const openParenIdx = match.index + match[0].length - 1;
	const closeParenIdx = findBalancedDelimiter(text, openParenIdx, '(', ')');

	if(closeParenIdx === -1)
	{
		return null;
	}

	const ctorParams = text.slice(openParenIdx + 1, closeParenIdx);
	const afterParams = text.slice(closeParenIdx + 1);
	const openBraceOffset = afterParams.indexOf('{');
	const semicolonOffset = afterParams.indexOf(';');

	let bodyStartIdx = -1;
	let bodyEndIdx = -1;
	let isSemicolonBody = false;

	if(semicolonOffset !== -1 && (openBraceOffset === -1 || semicolonOffset < openBraceOffset))
	{
		bodyStartIdx = closeParenIdx + 1 + semicolonOffset;
		bodyEndIdx = bodyStartIdx;
		isSemicolonBody = true;
	}
	else if(openBraceOffset !== -1)
	{
		bodyStartIdx = closeParenIdx + 1 + openBraceOffset;
		bodyEndIdx = findBalancedDelimiter(text, bodyStartIdx, '{', '}');
		if(bodyEndIdx === -1)
		{
			return null;
		}
	}
	else
	{
		return null;
	}

	const inheritancePart = text.slice(closeParenIdx + 1, bodyStartIdx);
	let baseArgs = null;
	let newInheritancePart = inheritancePart;

	const colonIdx = inheritancePart.indexOf(':');
	if(colonIdx !== -1)
	{
		const afterColon = inheritancePart.slice(colonIdx + 1);
		const baseOpenParen = afterColon.indexOf('(');
		if(baseOpenParen !== -1)
		{
			const absBaseOpen = colonIdx + 1 + baseOpenParen;
			const absBaseClose = findBalancedDelimiter(inheritancePart, absBaseOpen, '(', ')');
			if(absBaseClose !== -1)
			{
				baseArgs = inheritancePart.slice(absBaseOpen + 1, absBaseClose);
				newInheritancePart = inheritancePart.slice(0, absBaseOpen) + inheritancePart.slice(absBaseClose + 1);
			}
		}
	}

	const lineStart = text.lastIndexOf('\n', match.index) + 1;
	const indentMatch = text.slice(lineStart, match.index).match(/^\s*/);
	const classIndent = indentMatch ? indentMatch[0] : '';

	return {
		ctorName,
		ctorParams,
		baseArgs,
		openParenIdx,
		bodyStartIdx,
		bodyEndIdx,
		isSemicolonBody,
		newInheritancePart,
		classIndent
	};
}

function convertAtCursor(editor)
{
	const doc = editor.document;
	const fullText = doc.getText();

	const lineStartOffset = doc.offsetAt(new vscode.Position(editor.selection.active.line, 0));
	const searchSlice = fullText.slice(lineStartOffset);
	const parsed = parsePrimaryConstructor(searchSlice);

	if(!parsed)
	{
		vscode.window.showInformationMessage('No primary constructor found at cursor.');
		return;
	}

	const indent = parsed.classIndent;
	const memberIndent = indent + '\t';
	const baseInitializer = parsed.baseArgs !== null
		? `\n${memberIndent}\t: base(${parsed.baseArgs})`
		: '';

	const ctorBlock = `${memberIndent}public ${parsed.ctorName}(${parsed.ctorParams})${baseInitializer}\n${memberIndent}{\n${memberIndent}}`;

	const headerReplaceStart = doc.positionAt(lineStartOffset + parsed.openParenIdx);

	editor.edit(function(editBuilder)
	{
		if(parsed.isSemicolonBody)
		{
			const headerReplaceEnd = doc.positionAt(lineStartOffset + parsed.bodyStartIdx + 1);
			const replacementText = `${parsed.newInheritancePart}\n${indent}{\n${ctorBlock}\n${indent}}`;
			editBuilder.replace(new vscode.Range(headerReplaceStart, headerReplaceEnd), replacementText);
			return;
		}

		const headerReplaceEnd = doc.positionAt(lineStartOffset + parsed.bodyStartIdx);
		editBuilder.replace(new vscode.Range(headerReplaceStart, headerReplaceEnd), parsed.newInheritancePart);

		const classBodyContent = searchSlice.slice(parsed.bodyStartIdx + 1, parsed.bodyEndIdx);
		const lastPropEndOffset = findLastPropertyEnd(classBodyContent);

		if(lastPropEndOffset !== -1)
		{
			const insertPos = doc.positionAt(lineStartOffset + parsed.bodyStartIdx + 1 + lastPropEndOffset);
			editBuilder.insert(insertPos, `\n${ctorBlock}\n`);
		}
		else
		{
			const insertPos = doc.positionAt(lineStartOffset + parsed.bodyStartIdx + 1);
			editBuilder.insert(insertPos, `\n${ctorBlock}`);
		}
	});
}

function activate(context)
{
	const disposable = vscode.commands.registerCommand('extension.convertPrimaryCtor', function()
	{
		const editor = vscode.window.activeTextEditor;
		if(editor)
		{
			convertAtCursor(editor);
		}
	});

	const actionProvider = vscode.languages.registerCodeActionsProvider('csharp', {
		provideCodeActions(document, range)
		{
			const lineText = document.lineAt(range.start.line).text;
			if(/\b(class|struct)\s+[A-Za-z_]\w*(?:<[^>]+>)?\s*\(/.test(lineText))
			{
				const action = new vscode.CodeAction(
					'Convert primary constructor to regular constructor',
					vscode.CodeActionKind.RefactorRewrite
				);
				action.command = {
					command: 'extension.convertPrimaryCtor',
					title: 'Convert primary constructor to regular constructor'
				};
				return [action];
			}
			return [];
		}
	});

	context.subscriptions.push(disposable, actionProvider);
}

function deactivate()
{
}

module.exports = {
	activate,
	deactivate
};