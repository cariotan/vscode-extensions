const vscode = require("vscode");

function activate(context) {
 let disposable = vscode.commands.registerCommand("html-attribute-stacker.stack", function () {
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

  for (let i = 0; i <= cursorOffset; i++) {
   const char = text[i];
   
   if (char === "\"" && !inSingleQuote) {
    inDoubleQuote = !inDoubleQuote;
   } else if (char === "'" && !inDoubleQuote) {
    inSingleQuote = !inSingleQuote;
   }

   if (!inDoubleQuote && !inSingleQuote && char === "<") {
    if (text[i + 1] !== "/") {
     startOffset = i;
    }
   }
  }

  let endOffset = -1;
  if (startOffset !== -1) {
   inDoubleQuote = false;
   inSingleQuote = false;
   for (let i = startOffset; i < text.length; i++) {
    const char = text[i];

    if (char === "\"" && !inSingleQuote) {
     inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
     inSingleQuote = !inSingleQuote;
    }

    if (!inDoubleQuote && !inSingleQuote && char === ">") {
     endOffset = i;
     break;
    }
   }
  }

  if (startOffset === -1 || endOffset === -1 || cursorOffset < startOffset || cursorOffset > endOffset) {
   vscode.window.showInformationMessage("Cursor is not inside an HTML tag.");
   return;
  }

  const tagContent = text.substring(startOffset, endOffset + 1);

  const tagNameMatch = tagContent.match(/^<([^\s>]+)/);
  if (!tagNameMatch) return;
  const tagName = tagNameMatch[1];

  const isSelfClosing = tagContent.endsWith("/>") || tagContent.endsWith("/ >") || tagContent.trim().endsWith("/>");

  const attrRegex = /([^\s="'>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)/g;
  const endClip = isSelfClosing ? 2 : 1;
  const attributesString = tagContent.substring(tagName.length + 1, tagContent.length - endClip);
  const attributes = attributesString.match(attrRegex);

  if (!attributes || attributes.length === 0) {
   vscode.window.showInformationMessage("No attributes found to stack.");
   return;
  }

  let hasOnlyText = false;
  let textContent = "";

  if (!isSelfClosing) {
   const restOfText = text.substring(endOffset + 1);
   const closingTagRegex = new RegExp("^([\\s\\S]*?)</" + tagName + "\\s*>", "i");
   const closingMatch = restOfText.match(closingTagRegex);

   if (closingMatch && !closingMatch[1].includes("<")) {
    const trimmedText = closingMatch[1].trim();
    if (trimmedText.length > 0) {
     hasOnlyText = true;
     textContent = trimmedText;
     endOffset = endOffset + closingMatch[0].length;
    }
   }
  }

  const startPosition = document.positionAt(startOffset);
  const startLineText = document.lineAt(startPosition.line).text;
  const baseIndentMatch = startLineText.match(/^(\s*)/);
  const baseIndent = baseIndentMatch ? baseIndentMatch[1] : "";

  const valuelessAttributes = attributes.filter(attr => !attr.includes("="));
  const valuedAttributes = attributes.filter(attr => attr.includes("="));

  let newText = "<" + tagName;

  if (valuelessAttributes.length > 0) {
   newText += " " + valuelessAttributes.map(a => a.replace(/\s+/g, " ").trim()).join(" ");
  }

  if (valuedAttributes.length > 0) {
   newText += "\n";
   for (const attr of valuedAttributes) {
    const cleanedAttr = attr.replace(/\s+/g, " ").trim();
    newText += baseIndent + " " + cleanedAttr + "\n";
   }
   newText += baseIndent + (isSelfClosing ? "/>" : ">");
  } else {
   newText += isSelfClosing ? " />" : ">";
  }

  if (hasOnlyText) {
   newText += "\n" + baseIndent + " " + textContent + "\n" + baseIndent + "</" + tagName + ">";
  }

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
};