let vscode = require("vscode");

async function renameFile() {
 let editor = vscode.window.activeTextEditor;
 if (!editor) return;

 let currentFilePath = editor.document.fileName;
 let fileName = currentFilePath.split("\\").pop()?.split("/").pop() || "";
 let fileExtension = fileName.includes(".") ? "." + fileName.split(".").pop() : "";

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

 let newName;
 if (currentWord) {
  newName = currentWord + fileExtension;
 } else {
  newName = await vscode.window.showInputBox({
   prompt: "Enter the new file name",
   value: fileName
  });
 }

 if (!newName || newName === fileName) return;

 try {
  let cursorPosition = editor.selection.active;
  let viewColumn = editor.viewColumn;

  if (editor.document.isDirty) {
   await editor.document.save();
  }

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

function activate(context) {
 let renameFileDisposable = vscode.commands.registerCommand("editor.renameFile", renameFile);
 context.subscriptions.push(renameFileDisposable);
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
};