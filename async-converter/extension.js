const vscode = require('vscode');

function activate(context) {
  let disposable = vscode.commands.registerCommand('extension.convertToAsync', async function () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor.');
      return;
    }

    const doc = editor.document;
    const cursorLine = editor.selection.active.line;

    // Robust C# method detection regex (as string to avoid /x parsing issues)
    const methodRegex = new RegExp(
      '^(\\s*)' +                                      // 1. Indentation
      '(?:(public|private|protected|internal)\\s+)?' + // 2. Optional access modifier
      '(?:(static|virtual|override|abstract|sealed|unsafe|extern|new)\\s+)*' + // Optional modifiers
      '(?!await\\b|return\\b|if\\b|while\\b|for\\b|foreach\\b|using\\b|throw\\b|try\\b|catch\\b|else\\b)' + // Avoid common keywords
      '([\\w.<>\\[\\],?]+?)\\s+' +                      // 3. Return type (lazy)
      '([\\w]+)\\s*' +                                 // 4. Method name
      '(\\()'                                          // 5. Opening parenthesis
    );

    let methodLineNumber = null;
    let capturedGroups = null;

    // Search upwards from cursor
    for (let i = cursorLine; i >= 0; i--) {
      const lineText = doc.lineAt(i).text;

      // Skip empty lines, comments, closing braces
      if (!lineText.trim() || lineText.trimStart().startsWith('//') || lineText.trim() === '}') {
        continue;
      }

      const match = lineText.match(methodRegex);
      if (match) {
        const returnType = match[3]?.trim();
        const methodName = match[4];

        // Extra guard: skip property accessors
        if (/\b(get|set)\b/.test(lineText) && lineText.includes('{')) {
          continue;
        }

        // Avoid matching local function declarations inside methods incorrectly (basic heuristic)
        if (i > 0) {
          const prevLine = doc.lineAt(i - 1).text.trim();
          if (prevLine.endsWith('{') || prevLine.includes('=>')) {
            continue; // likely inside a method body
          }
        }

        methodLineNumber = i;
        capturedGroups = match;
        break;
      }
    }

    if (methodLineNumber === null) {
      vscode.window.showInformationMessage('No valid C# method found above cursor.');
      return;
    }

    const [_, indent, accessModifier, __, returnTypeRaw, methodName, openingParen] = capturedGroups;
    const originalLine = doc.lineAt(methodLineNumber).text;

    // Extract everything from ( onward (parameters, attributes, constraints)
    const paramStartIndex = originalLine.indexOf('(');
    const restOfSignature = originalLine.substring(paramStartIndex);

    // Build new return type
    const cleanReturnType = returnTypeRaw.trim();
    const newReturnType = cleanReturnType === 'void' ? 'Task' : `Task<${cleanReturnType}>`;

    // Build modifiers (preserve order, add async if missing)
    const modifiers = [];
    if (accessModifier) modifiers.push(accessModifier);

    const knownModifiers = ['static', 'virtual', 'override', 'abstract', 'sealed', 'unsafe', 'extern', 'new'];
    for (const mod of knownModifiers) {
      if (originalLine.includes(` ${mod} `) || originalLine.startsWith(mod + ' ')) {
        modifiers.push(mod);
      }
    }

    if (!originalLine.includes(' async ')) {
      modifiers.push('async');
    }

    const modifierString = modifiers.length > 0 ? modifiers.join(' ') + ' ' : '';

    const newSignature = `${indent}${modifierString}${newReturnType} ${methodName}${restOfSignature}`;

    // Apply edits
    const edit = new vscode.WorkspaceEdit();
    const fullLineRange = doc.lineAt(methodLineNumber).rangeIncludingLineBreak;
    edit.replace(doc.uri, fullLineRange, newSignature + '\n');

    // Add using System.Threading.Tasks; if missing
    const fullText = doc.getText();
    if (!/using\s+System\.Threading\.Tasks;/.test(fullText)) {
      let insertLine = 0;
      for (let i = 0; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text;
        if (/^using\s+\w/.test(line)) {
          insertLine = i + 1;
        } else if (line.trim() && !line.startsWith('//')) {
          break;
        }
      }
      edit.insert(doc.uri, new vscode.Position(insertLine, 0), 'using System.Threading.Tasks;\n');
    }

    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage(`Converted '${methodName}' to async successfully!`);
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };