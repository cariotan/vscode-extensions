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

        // Step 1: Protect Razor expressions
        const razorRegex = /@\([^)]*\)/g;
        const razorPlaceholders = [];
        newText = newText.replace(razorRegex, (match) => {
            razorPlaceholders.push(match);
            return `__RAZOR_${razorPlaceholders.length - 1}__`;
        });

        // Step 2: Convert HTML attribute quotes
        const htmlAttrRegex = /(\w+)=("|')([^'"]*)\2/g;
        let match;
        while ((match = htmlAttrRegex.exec(newText)) !== null) {
            const [fullMatch, attrName, quoteType, content] = match;
            if (quoteType === '"') {
                const newAttr = `${attrName}='${content}'`;
                newText = newText.replace(fullMatch, newAttr);
                htmlReplacements++;
            }
        }

        // Step 3: Restore Razor expressions
        razorPlaceholders.forEach((razor, index) => {
            newText = newText.replace(`__RAZOR_${index}__`, razor);
        });

        // Step 4: Convert JavaScript double quotes in <script> tags
        if (['html', 'razor'].includes(document.languageId)) {
            // Convert <script> tag content
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
        } else if (['javascript', 'javascriptreact'].includes(document.languageId)) {
            // Convert entire file if it's .js or .jsx
            newText = newText.replace(
                /(?<!\\)"([^"\n\r]*[^\\])"/g,
                (_, content) => `'${content}'`
            );
            jsReplacements += (fullText.match(/"([^"\n\r]*[^\\])"/g) || []).length;
        }

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