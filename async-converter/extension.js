const vscode = require('vscode');

function activate(context) {
  let disposable = vscode.commands.registerCommand('extension.convertToAsync', async function () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("No active editor.");
      return;
    }

    const doc = editor.document;
    const cursorLine = editor.selection.active.line;

    const methodRegex = /^([ \t]*)(public|private|protected|internal)?(?:\s+)?(static|virtual|override|sealed|unsafe|extern)?(?:\s+)?([\w<>\[\]?]+)\s+(\w+)\s*(\(.*)/ ;

    let methodLine = null;
    for (let i = cursorLine; i >= 0; i--) {
      const lineText = doc.lineAt(i).text;
      if (methodRegex.test(lineText)) {
        methodLine = i;
        break;
      }
    }

    if (methodLine === null) {
      vscode.window.showInformationMessage("Could not find a C# method signature above cursor.");
      return;
    }

    const lineText = doc.lineAt(methodLine).text;
    const match = lineText.match(methodRegex);

    if (!match) {
      vscode.window.showInformationMessage("Failed to parse method signature.");
      return;
    }

    const [_, indent, access, modifier, returnType, methodName, restOfSignature] = match;

    const newReturn = returnType === 'void' ? 'Task' : `Task<${returnType}>`;
    const modifiers = [access, modifier, 'async'].filter(Boolean).join(' ');
    const newLine = `${indent}${modifiers} ${newReturn} ${methodName}${restOfSignature}`;

    const edit = new vscode.WorkspaceEdit();
    const methodRange = doc.lineAt(methodLine).range;
    edit.replace(doc.uri, methodRange, newLine);

    // Add using if needed
    const fullText = doc.getText();
    if (!fullText.includes('using System.Threading.Tasks;')) {
      edit.insert(doc.uri, new vscode.Position(0, 0), 'using System.Threading.Tasks;\n');
    }

    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage("Method converted to async.");
  });

  context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
};