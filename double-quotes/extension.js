const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('extension.convertHtmlQuotes', function () {
        const editor = vscode.window.activeTextEditor;
        
        if (!editor) {
            vscode.window.showInformationMessage('No active editor found');
            return;
        }

        const document = editor.document;
        const fullText = document.getText();
        
        let newText = fullText;
        let htmlReplacements = 0;
        let jsReplacements = 0;

        // Step 1: Convert HTML attribute quotes, preserving Razor expressions
        const htmlAttrRegex = /(\w+)=("|')((?:@\(.*?\)|[^'"]*))\2/g;
        let match;
        while ((match = htmlAttrRegex.exec(fullText)) !== null) {
            const [fullMatch, attrName, quoteType, content] = match;
            if (quoteType === '"') {
                // Replace double quotes with single quotes, keeping content intact
                const newAttr = `${attrName}='${content}'`;
                newText = newText.replace(fullMatch, newAttr);
                htmlReplacements++;
            }
        }

        // Step 2: Convert JavaScript double quotes in <script> tags
        const scriptTagRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
        newText = newText.replace(scriptTagRegex, (scriptTagMatch, scriptContent) => {
            if (!scriptContent.trim()) return scriptTagMatch;
            let updatedScript = scriptContent.replace(
                /(?<!\\)"([^"\n\r]*[^\\])"/g,
                (_, content) => `'${content}'`
            );
            jsReplacements += (scriptContent.match(/"([^"\n\r]*[^\\])"/g) || []).length;
            return scriptTagMatch.replace(scriptContent, updatedScript);
        });

        // Apply the changes
        editor.edit(editBuilder => {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(fullText.length)
            );
            editBuilder.replace(fullRange, newText);
        }).then(success => {
            if (success) {
                vscode.window.showInformationMessage(
                    `Converted ${htmlReplacements} HTML attributes and ${jsReplacements} JS strings to single quotes`
                );
            }
        });
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}