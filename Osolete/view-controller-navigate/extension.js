const vscode = require('vscode')
const path = require('path')
const fs = require('fs')

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
 let disposable = vscode.commands.registerCommand('extension.toggleViewControl', async function () {
  const editor = vscode.window.activeTextEditor
  if (!editor) return

  const filePath = editor.document.fileName
  const isController = filePath.endsWith('Controller.cs')
  const isView = filePath.endsWith('.cshtml')

  let targetPath

  if (isController) {
   const controllerName = path.basename(filePath, 'Controller.cs')
   
   targetPath = filePath
    .replace(`${path.sep}Controllers${path.sep}`, `${path.sep}Views${path.sep}`)
    .replace(`${controllerName}Controller.cs`, path.join(controllerName, 'Index.cshtml'))
  } 
  else if (isView) {
   const segments = filePath.split(path.sep)
   const viewsIndex = segments.lastIndexOf('Views')

   if (viewsIndex !== -1 && segments.length > viewsIndex + 1) {
    const controllerName = segments[viewsIndex + 1]
    const rootPath = segments.slice(0, viewsIndex).join(path.sep)
    
    targetPath = path.join(rootPath, 'Controllers', `${controllerName}Controller.cs`)
   }
  }

  if (targetPath && fs.existsSync(targetPath)) {
   const doc = await vscode.workspace.openTextDocument(targetPath)
   await vscode.window.showTextDocument(doc)
  } else if (targetPath) {
   vscode.window.showErrorMessage(`Target not found: ${path.basename(targetPath)}`)
  }
 })

 context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
}