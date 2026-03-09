const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

function activate(context) {
 let disposable = vscode.commands.registerCommand('controller-action-jumper.jump', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const range = editor.document.getWordRangeAtPosition(editor.selection.active);
  if (!range) return;
  const word = editor.document.getText(range);
  const lineText = editor.document.lineAt(editor.selection.active.line).text;

  const filePath = editor.document.fileName;
  const fileName = path.basename(filePath);
  const isController = fileName.endsWith('Controller.cs');

  let targetColumn = vscode.ViewColumn.Active;
  if (vscode.window.tabGroups.all.length === 2) {
   targetColumn = (editor.viewColumn === 1) ? 2 : 1;
  }

  const openFile = async (targetPath, searchWord) => {
   const doc = await vscode.workspace.openTextDocument(targetPath);
   const text = doc.getText();
   const index = searchWord ? text.indexOf(searchWord) : 0;
   const pos = doc.positionAt(index !== -1 ? index : 0);
   const newEditor = await vscode.window.showTextDocument(doc, { viewColumn: targetColumn, preserveFocus: false });
   newEditor.selection = new vscode.Selection(pos, pos);
   newEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  };

  // 1. PARTIAL SEARCH LOGIC (Triggered if word starts with _ or line has <partial)
  if (word.startsWith('_') || lineText.includes('<partial')) {
   const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
   const findFile = (dir, name) => {
    const files = fs.readdirSync(dir);
    for (const f of files) {
     const fullPath = path.join(dir, f);
     if (fs.statSync(fullPath).isDirectory()) {
      const found = findFile(fullPath, name);
      if (found) return found;
     } else if (f === name || f === name + '.cshtml') {
      return fullPath;
     }
    }
    return null;
   };

   // Search in Areas and Views
   const searchPaths = [path.join(workspaceRoot, 'Views'), path.join(workspaceRoot, 'Areas')];
   for (const sPath of searchPaths) {
    if (fs.existsSync(sPath)) {
     const foundPath = findFile(sPath, word);
     if (foundPath) {
      await openFile(foundPath);
      return;
     }
    }
   }
   vscode.window.showWarningMessage(`Partial ${word} not found.`);
   return;
  }

  // 2. CONTROLLER -> VIEW
  if (isController) {
   const controllerName = fileName.replace('Controller.cs', '');
   const controllerDir = path.dirname(filePath);
   const areaDir = path.dirname(controllerDir);
   const isArea = path.basename(controllerDir) === 'Controllers' && path.basename(path.dirname(areaDir)) === 'Areas';
   const viewsPath = isArea ? path.join(areaDir, "Views", controllerName) : path.join(path.dirname(controllerDir), "Views", controllerName);

   if (fs.existsSync(viewsPath)) {
    const files = fs.readdirSync(viewsPath);
    for (const f of files) {
     if (!f.endsWith('.cshtml')) continue;
     const fullPath = path.join(viewsPath, f);
     if (fs.readFileSync(fullPath, 'utf8').includes(word)) {
      await openFile(fullPath, word);
      return;
     }
    }
   }
  } 
  // 3. VIEW -> CONTROLLER
  else if (fileName.endsWith('.cshtml')) {
   const pathParts = filePath.split(path.sep);
   const viewsIndex = pathParts.lastIndexOf("Views");
   if (viewsIndex === -1) return;

   const folderName = pathParts[viewsIndex + 1];
   const areasIndex = pathParts.lastIndexOf("Areas");
   let controllerPath = (areasIndex !== -1 && areasIndex < viewsIndex) 
    ? path.join(pathParts.slice(0, areasIndex + 2).join(path.sep), "Controllers", `${folderName}Controller.cs`)
    : path.join(pathParts.slice(0, viewsIndex).join(path.sep), "Controllers", `${folderName}Controller.cs`);

   if (fs.existsSync(controllerPath)) {
    await openFile(controllerPath, word);
   }
  }
 });
 context.subscriptions.push(disposable);
}

exports.activate = activate;