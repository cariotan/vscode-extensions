const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('split-attribute.format', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const selection = editor.selection;
        const line = document.lineAt(selection.active.line);
        const lineText = line.text;
        const cursorChar = selection.active.character;

        // Pulls the exact whitespace currently starting the line
        const baseIndentation = lineText.match(/^\s*/)[0];

        // Regex: handles attribute-names, 'single' or "double" quotes, and the value
        const regex = /([\w-]+)\s*=\s*(['"])(.*?)\2/g;
        let match;
        let found = false;

        while ((match = regex.exec(lineText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (cursorChar >= start && cursorChar <= end) {
                const attrName = match[1];
                const quote = match[2];
                const content = match[3];

                // Formatting:
                // name=
                // [indent]'
                // [indent][tab]value
                // [indent]'
                const replacement = `${attrName}=\n${baseIndentation}${quote}\n${baseIndentation}\t${content}\n${baseIndentation}${quote}`;

                editor.edit(editBuilder => {
                    const range = new vscode.Range(line.lineNumber, start, line.lineNumber, end);
                    editBuilder.replace(range, replacement);
                });
                found = true;
                break;
            }
        }

        if (!found) {
            vscode.window.setStatusBarMessage('Cursor not inside an attribute.', 3000);
        }
    });

    context.subscriptions.push(disposable);
}

exports.activate = activate;