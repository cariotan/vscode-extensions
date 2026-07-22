let vscode = require("vscode");

function splitWords(str) {
 if (!str) return [];
 return str.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/);
}

function camelCase(str) {
 let words = splitWords(str);
 return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function pascalCase(str) {
 let words = splitWords(str);
 return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function kebabCase(str) {
 return splitWords(str).map(w => w.toLowerCase()).join("-");
}

function snakeCase(str) {
 return splitWords(str).map(w => w.toLowerCase()).join("_");
}

async function renameFile(suggestFromCursor = true) {
 let editor = vscode.window.activeTextEditor;

 if (!editor) {
  return;
 }

 let currentFileName = editor.document.fileName;
 let fileName = currentFileName.split("\\").pop()?.split("/").pop() || "";
 let fileExtension = fileName.includes(".") ? "." + fileName.split(".").pop() : "";
 let fileNameWithoutExt = fileName.replace(fileExtension, "");

 let suggestions = [];
 let defaultValue = fileName;
 let selectionLength = fileNameWithoutExt.length;

 if (suggestFromCursor) {
  let currentWord = "";
  
  if (!editor.selection.isEmpty) {
   currentWord = editor.document.getText(editor.selection);
  } else {
   let position = editor.selection.active;
   let wordRange = editor.document.getWordRangeAtPosition(position);
   if (wordRange) {
    currentWord = editor.document.getText(wordRange);
   }
  }

  if (currentWord) {
   let config = vscode.workspace.getConfiguration("renameFile");
   let languageNamingStyles = config.get("languageNamingStyles", {});
   let currentLanguage = editor.document.languageId;

   let preferredStyle = languageNamingStyles[currentLanguage] || languageNamingStyles["*"] || "camelCase";

   let caseOptions = [
    {
     label: camelCase(currentWord) + fileExtension,
     description: "camelCase",
     isPreferred: preferredStyle === "camelCase",
     nameOnly: camelCase(currentWord),
     alwaysShow: true
    },
    {
     label: pascalCase(currentWord) + fileExtension,
     description: "PascalCase",
     isPreferred: preferredStyle === "PascalCase",
     nameOnly: pascalCase(currentWord),
     alwaysShow: true
    },
    {
     label: kebabCase(currentWord) + fileExtension,
     description: "kebab-case",
     isPreferred: preferredStyle === "kebab-case",
     nameOnly: kebabCase(currentWord),
     alwaysShow: true
    },
    {
     label: snakeCase(currentWord) + fileExtension,
     description: "snake_case",
     isPreferred: preferredStyle === "snake_case",
     nameOnly: snakeCase(currentWord),
     alwaysShow: true
    },
   ];

   suggestions.push(...caseOptions);

   let preferredItem = suggestions.find((item) => item.isPreferred);
   if (preferredItem) {
    defaultValue = preferredItem.label;
    selectionLength = preferredItem.nameOnly.length;
   }
  }
 }

 let quickPick = vscode.window.createQuickPick();
 quickPick.items = suggestions;
 quickPick.placeholder = fileName || "Enter the new file name";
 quickPick.title = `Rename File: ${fileName}`;
 quickPick.canSelectMany = false;
 quickPick.value = defaultValue;

 if (suggestions.length > 0) {
  let preferredItem = suggestions.find((item) => item.isPreferred);
  if (preferredItem) {
   quickPick.activeItems = [preferredItem];
  }
 }

 setTimeout(() => {
  if (quickPick.value === defaultValue) {
   quickPick.valueSelection = [0, selectionLength];
  }
 }, 10);

 quickPick.show();

 let newName = await new Promise((resolve) => {
  quickPick.onDidAccept(() => {
   let selected = quickPick.selectedItems[0];
   if (selected) {
    resolve(selected.label);
   } else {
    resolve(quickPick.value);
   }
   quickPick.dispose();
  });

  quickPick.onDidHide(() => {
   resolve(undefined);
   quickPick.dispose();
  });
 });

 if (newName) {
  try {
   let cursorPosition = editor.selection.active;
   let viewColumn = editor.viewColumn;

   if (editor.document.isDirty) {
    await editor.document.save();
   }

   let currentFilePath = editor.document.fileName;
   let currentDir = currentFilePath.substring(
    0,
    currentFilePath.lastIndexOf("\\") !== -1 ? currentFilePath.lastIndexOf("\\") : currentFilePath.lastIndexOf("/")
   );
   let newFilePath = currentDir + (currentFilePath.includes("\\") ? "\\" : "/") + newName;

   let currentFileUri = vscode.Uri.file(currentFilePath);
   let newFileUri = vscode.Uri.file(newFilePath);

   await vscode.workspace.fs.rename(currentFileUri, newFileUri, { overwrite: false });

   if (newName.toLowerCase() !== fileName.toLowerCase()) {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    let newDocument = await vscode.workspace.openTextDocument(newFileUri);
    let newEditor = await vscode.window.showTextDocument(newDocument, viewColumn);
    newEditor.selection = new vscode.Selection(cursorPosition, cursorPosition);
   }
  } catch (error) {
   vscode.window.showErrorMessage(`Error renaming file: ${error}`);
  }
 }
}

function activate(context) {
 let renameFileDisposable = vscode.commands.registerCommand("editor.renameFile", () => renameFile(false));
 let renameFileSmartDisposable = vscode.commands.registerCommand("editor.renameFileSmart", () => renameFile(true));

 context.subscriptions.push(renameFileDisposable, renameFileSmartDisposable);
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
};