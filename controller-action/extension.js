const vscode = require('vscode')
const path = require('path')
const fs = require('fs')

function activate(context) {
 let disposable = vscode.commands.registerCommand('controller-action-jumper.jump', async () => {
  const editor = vscode.window.activeTextEditor
  if (!editor) return

  const lineText = editor.document.lineAt(editor.selection.active.line).text
  const filePath = editor.document.fileName
  const fileName = path.basename(filePath)

  // REUSABLE FUNCTIONS
  const getAppPaths = (currentPath) => {
   const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : ''
   const parts = currentPath.split(path.sep)
   const areasIdx = parts.lastIndexOf('Areas')
   let controllersDir = path.join(workspaceRoot, 'Controllers')
   let viewsDir = path.join(workspaceRoot, 'Views')
   
   if (areasIdx !== -1 && areasIdx + 1 < parts.length) {
    const areaRoot = parts.slice(0, areasIdx + 2).join(path.sep)
    controllersDir = path.join(areaRoot, 'Controllers')
    viewsDir = path.join(areaRoot, 'Views')
   }
   return { controllersDir, viewsDir, rootViewsDir: path.join(workspaceRoot, 'Views') }
  }

  const jumpToController = async (currentPath, targetController, targetAction) => {
   const paths = getAppPaths(currentPath)
   const controllerPath = path.join(paths.controllersDir, `${targetController}Controller.cs`)
   if (fs.existsSync(controllerPath)) {
    const doc = await vscode.workspace.openTextDocument(controllerPath)
    const text = doc.getText()
    const regex = new RegExp(`(?:public|async).*\\s${targetAction}\\s*\\(`)
    const match = text.match(regex)
    const index = match ? match.index : text.indexOf(targetAction)
    const pos = doc.positionAt(index !== -1 ? index : 0)
    const newEditor = await vscode.window.showTextDocument(doc, { preserveFocus: false })
    newEditor.selection = new vscode.Selection(pos, pos)
    newEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
   }
  }

  const jumpToView = async (currentPath, viewFolder, actionName) => {
   const paths = getAppPaths(currentPath)
   const viewPath = path.join(paths.viewsDir, viewFolder, `${actionName}.cshtml`)
   if (fs.existsSync(viewPath)) {
    const doc = await vscode.workspace.openTextDocument(viewPath)
    await vscode.window.showTextDocument(doc, { preserveFocus: false })
   }
  }

  const jumpToPartial = async (currentPath, partialName) => {
   const paths = getAppPaths(currentPath)
   const targetName = partialName.endsWith('.cshtml') ? partialName : `${partialName}.cshtml`
   
   const localPath = path.join(path.dirname(currentPath), targetName)
   if (fs.existsSync(localPath)) {
    const doc = await vscode.workspace.openTextDocument(localPath)
    await vscode.window.showTextDocument(doc, { preserveFocus: false })
    return
   }
   
   const sharedPath = path.join(paths.viewsDir, 'Shared', targetName)
   if (fs.existsSync(sharedPath)) {
    const doc = await vscode.workspace.openTextDocument(sharedPath)
    await vscode.window.showTextDocument(doc, { preserveFocus: false })
    return
   }
   
   const rootSharedPath = path.join(paths.rootViewsDir, 'Shared', targetName)
   if (fs.existsSync(rootSharedPath)) {
    const doc = await vscode.workspace.openTextDocument(rootSharedPath)
    await vscode.window.showTextDocument(doc, { preserveFocus: false })
   }
  }

  const parseMethodArgs = (text, methodName) => {
   const cleanMethod = methodName.replace('.', '\\.')
   const regex = new RegExp(`${cleanMethod}\\s*\\(([^)]*)\\)`)
   const match = text.match(regex)
   if (!match) return []
   
   const inner = match[1]
   if (!inner.trim()) return []
   
   const args = inner.split(',').map(s => s.trim())
   return args.map(a => {
    const strMatch = a.match(/^['"]([^'"]+)['"]$/)
    return strMatch ? { isString: true, value: strMatch[1] } : { isString: false, value: a }
   })
  }

  const getCurrentActionName = () => {
   const text = editor.document.getText()
   const cursorOffset = editor.document.offsetAt(editor.selection.active)
   const textBeforeCursor = text.substring(0, cursorOffset)
   const regex = /(?:public|async|private|protected)\s+(?:async\s+)?(?:Task<[^>]+>\s+|IActionResult\s+|ActionResult\s+|ViewResult\s+|string\s+|[^\s]+\s+)([A-Za-z0-9_]+)\s*\(/g
   let match
   let lastMatch = null
   while ((match = regex.exec(textBeforeCursor)) !== null) {
    lastMatch = match[1]
   }
   return lastMatch
  }

  const handleCsMethodJump = async (methodName) => {
   const args = parseMethodArgs(lineText, methodName)
   let actionName = ''
   let viewFolderName = fileName.replace('Controller.cs', '')
   
   if (args.length === 0 || (args.length === 1 && !args[0].isString)) {
    actionName = getCurrentActionName()
   } else if (args.length === 1 && args[0].isString) {
    actionName = args[0].value
   } else if (args.length >= 2 && args[0].isString && args[1].isString) {
    actionName = args[0].value
    viewFolderName = args[1].value
   }
   
   if (actionName) {
    await jumpToView(filePath, viewFolderName, actionName)
   }
  }

  // INDEPENDENT CSHTML BRANCHES
  if (fileName.endsWith('.cshtml')) {
   
   if (lineText.includes('Url.Action(')) {
    const args = parseMethodArgs(lineText, 'Url.Action')
    let actionName = ''
    let controllerName = ''
    
    if (args.length === 1 && args[0].isString) {
     actionName = args[0].value
     const parts = filePath.split(path.sep)
     const viewsIdx = parts.lastIndexOf('Views')
     controllerName = parts[viewsIdx + 1]
    } else if (args.length >= 2 && args[0].isString && args[1].isString) {
     actionName = args[0].value
     controllerName = args[1].value
    }
    
    if (actionName && controllerName) {
     await jumpToController(filePath, controllerName, actionName)
    }
    return
   }

   if (lineText.includes('<partial')) {
    const match = lineText.match(/name=['"]([^'"]+)['"]/)
    if (match) {
     await jumpToPartial(filePath, match[1])
    }
    return
   }

  }

  // INDEPENDENT CS BRANCHES
  if (fileName.endsWith('.cs')) {
   
   if (/\bView\s*\(/.test(lineText)) {
    await handleCsMethodJump('View')
    return
   }

   if (/\bPartialView\s*\(/.test(lineText)) {
    await handleCsMethodJump('PartialView')
    return
   }

   if (/\bRedirectToAction\s*\(/.test(lineText)) {
    await handleCsMethodJump('RedirectToAction')
    return
   }

   if (/\bUrl\.Action\s*\(/.test(lineText)) {
    await handleCsMethodJump('Url.Action')
    return
   }

  }

 })
 context.subscriptions.push(disposable)
}

exports.activate = activate