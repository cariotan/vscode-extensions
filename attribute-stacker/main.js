const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('html-attribute-stacker.stack', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const cursorPosition = selection.active;
        const text = document.getText();
        const cursorOffset = document.offsetAt(cursorPosition);

        let startOffset = -1;
        let inDoubleQuote = false;
        let inSingleQuote = false;

        // 1. Scan from start of document to cursor to safely identify the opening '<'
        // This ensures quote tracking is 100% accurate.
        for (let i = 0; i <= cursorOffset; i++) {
            const char = text[i];
            
            // Track double quotes
            if (char === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
            } 
            // Track single quotes
            else if (char === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
            }

            // Find the opening tag '<' outside of quotes
            if (!inDoubleQuote && !inSingleQuote && char === '<') {
                // Ensure it is not a closing tag '</'
                if (text[i + 1] !== '/') {
                    startOffset = i;
                }
            }
        }

        // 2. Scan forward from the startOffset to find the matching closing '>'
        let endOffset = -1;
        if (startOffset !== -1) {
            inDoubleQuote = false;
            inSingleQuote = false;
            for (let i = startOffset; i < text.length; i++) {
                const char = text[i];

                if (char === '"' && !inSingleQuote) {
                    inDoubleQuote = !inDoubleQuote;
                } else if (char === "'" && !inDoubleQuote) {
                    inSingleQuote = !inSingleQuote;
                }

                if (!inDoubleQuote && !inSingleQuote && char === '>') {
                    endOffset = i;
                    break;
                }
            }
        }

        // 3. Validation: Verify cursor is actually inside the detected tag range
        if (startOffset === -1 || endOffset === -1 || cursorOffset < startOffset || cursorOffset > endOffset) {
            vscode.window.showInformationMessage('Cursor is not inside an HTML tag.');
            return;
        }

        const tagContent = text.substring(startOffset, endOffset + 1);

        // 4. Extract the Tag Name
        const tagNameMatch = tagContent.match(/^<([^\s>]+)/);
        if (!tagNameMatch) return;
        const tagName = tagNameMatch[1];

        // Check if it's a self-closing tag (ends with '/>' or has '/' before '>')
        const isSelfClosing = tagContent.endsWith('/>') || tagContent.endsWith('/ >') || tagContent.trim().endsWith('/>');

        // 5. Parse individual attributes (handles quotes and multiline attributes)
        const attrRegex = /([^\s="'>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)/g;
        // Trim tag name and trailing brackets to isolate attributes string
        const endClip = isSelfClosing ? 2 : 1;
        const attributesString = tagContent.substring(tagName.length + 1, tagContent.length - endClip);
        const attributes = attributesString.match(attrRegex);

        if (!attributes || attributes.length === 0) {
            vscode.window.showInformationMessage('No attributes found to stack.');
            return;
        }

        // 6. Determine base indentation of the line where the tag starts
        const startPosition = document.positionAt(startOffset);
        const startLineText = document.lineAt(startPosition.line).text;
        const baseIndentMatch = startLineText.match(/^(\s*)/);
        const baseIndent = baseIndentMatch ? baseIndentMatch[1] : '';

        // 7. Reconstruct the HTML tag with stacked attributes
        let newText = `<${tagName}\n`;
        for (const attr of attributes) {
            // Normalize internal white spaces inside the attribute
            const cleanedAttr = attr.replace(/\s+/g, ' ').trim();
            newText += `${baseIndent}\t${cleanedAttr}\n`;
        }
        newText += `${baseIndent}${isSelfClosing ? '/>' : '>'}`;

        // 8. Replace the old range with the newly formatted string
        const endPosition = document.positionAt(endOffset + 1);
        const rangeToReplace = new vscode.Range(startPosition, endPosition);

        editor.edit(editBuilder => {
            editBuilder.replace(rangeToReplace, newText);
        });
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}