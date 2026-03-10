const vscode = require('vscode')
const path = require('path')

function activate(context) {
 let disposable = vscode.commands.registerCommand('extension.toggleViewControl', async function () {
  const editor = vscode.window.activeTextEditor

  if (!editor) return

  const fileName = editor.document.fileName
  const isView = fileName.endsWith('.cshtml')
  const isController = fileName.endsWith('Controller.cs')

  if (!isView && !isController) {
   vscode.window.showWarningMessage('Not a .cshtml or Controller.cs file.')
   return
  }

  const pathParts = fileName.split(path.sep)
  const areasIndex = pathParts.lastIndexOf('Areas')
  let searchPattern

  if (isView) {
   const viewsIndex = pathParts.lastIndexOf('Views')
   if (viewsIndex === -1) return
   
   const controllerFolderName = pathParts[viewsIndex + 1]
   const targetFile = `${controllerFolderName}Controller.cs`

   if (areasIndex !== -1 && viewsIndex > areasIndex) {
    const areaName = pathParts[areasIndex + 1]
    searchPattern = `**/Areas/${areaName}/Controllers/${targetFile}`
   } else {
    searchPattern = `**/Controllers/${targetFile}`
   }
  } else {
   const controllerName = pathParts[pathParts.length - 1].replace('Controller.cs', '')
   const targetFile = 'Index.cshtml'

   if (areasIndex !== -1) {
    const areaName = pathParts[areasIndex + 1]
    searchPattern = `**/Areas/${areaName}/Views/${controllerName}/${targetFile}`
   } else {
    searchPattern = `**/Views/${controllerName}/${targetFile}`
   }
  }

  const files = await vscode.workspace.findFiles(searchPattern, null, 1)

  if (files && files.length > 0) {
   const doc = await vscode.workspace.openTextDocument(files[0])
   const visibleEditors = vscode.window.visibleTextEditors
   let targetColumn

   if (visibleEditors.length > 1) {
    // If we have 2 panes, find the one that isn't the active one
    const currentColumn = editor.viewColumn
    targetColumn = currentColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One
   } else {
    // If only 1 pane, open beside
    targetColumn = vscode.ViewColumn.Beside
   }

   await vscode.window.showTextDocument(doc, {
    viewColumn: targetColumn,
    preserveFocus: false
   })
  } else {
   vscode.window.showErrorMessage('Could not find the corresponding file.')
  }
 })

 context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
}