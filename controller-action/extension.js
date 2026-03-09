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

  const filePath = editor.document.fileName;
  const fileName = path.basename(filePath);
  const isController = fileName.endsWith('Controller.cs');

  // PANE LOGIC: 1 = Left, 2 = Right.
  let targetColumn = vscode.ViewColumn.Active;
  if (vscode.window.tabGroups.all.length === 2) {
   if (editor.viewColumn === 1) {
    targetColumn = 2;
   } else {
    targetColumn = 1;
   }
  }

  const openTarget = async (doc, offset) => {
   const pos = doc.positionAt(offset !== -1 ? offset : 0);
   const newEditor = await vscode.window.showTextDocument(doc, { 
    viewColumn: targetColumn,
    preserveFocus: false 
   });
   newEditor.selection = new vscode.Selection(pos, pos);
   newEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  };

  if (isController) {
   const controllerName = fileName.replace('Controller.cs', '');
   const controllerDir = path.dirname(filePath);
   const areaDir = path.dirname(controllerDir);
   const isArea = path.basename(controllerDir) === 'Controllers' && path.basename(path.dirname(areaDir)) === 'Areas';
   
   const viewsPath = isArea 
    ? path.join(areaDir, "Views", controllerName)
    : path.join(path.dirname(controllerDir), "Views", controllerName);

   if (!fs.existsSync(viewsPath)) return;

   const files = fs.readdirSync(viewsPath);
   for (const f of files) {
    if (!f.endsWith('.cshtml')) continue;
    const fullPath = path.join(viewsPath, f);
    const content = fs.readFileSync(fullPath, 'utf8');
    
    if (content.includes(word)) {
     const doc = await vscode.workspace.openTextDocument(fullPath);
     await openTarget(doc, doc.getText().indexOf(word));
     return;
    }
   }
  } else if (fileName.endsWith('.cshtml')) {
   const pathParts = filePath.split(path.sep);
   const viewsIndex = pathParts.lastIndexOf("Views");
   if (viewsIndex === -1) return;

   const folderName = pathParts[viewsIndex + 1];
   const areasIndex = pathParts.lastIndexOf("Areas");
   
   let controllerPath = "";
   if (areasIndex !== -1 && areasIndex < viewsIndex) {
    const areaPath = pathParts.slice(0, areasIndex + 2).join(path.sep);
    controllerPath = path.join(areaPath, "Controllers", `${folderName}Controller.cs`);
   } else {
    const rootPath = pathParts.slice(0, viewsIndex).join(path.sep);
    controllerPath = path.join(rootPath, "Controllers", `${folderName}Controller.cs`);
   }

   if (!fs.existsSync(controllerPath)) return;

   const doc = await vscode.workspace.openTextDocument(controllerPath);
   const text = doc.getText();
   const index = text.indexOf(word);
   if (index !== -1) {
    await openTarget(doc, index);
   }
  }
 });
 context.subscriptions.push(disposable);
}

exports.activate = activate;