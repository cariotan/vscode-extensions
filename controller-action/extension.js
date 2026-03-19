function activate(context) {
 const vscode = require('vscode')
 const path = require('path')
 const fs = require('fs')

 const disposable = vscode.commands.registerCommand('controller-action-jumper.jump', async function () {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  
  const document = editor.document
  const position = editor.selection.active
  const lineText = document.lineAt(position.line).text
  const filePath = document.uri.fsPath
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath

  console.log('--- Jumper Debug Start ---')
  console.log('Line Text:', lineText)

  if (!workspaceFolder) {
   console.log('Error: No workspace folder found')
   return
  }

  const isCshtml = filePath.toLowerCase().endsWith('.cshtml')
  const isCs = filePath.toLowerCase().endsWith('.cs')
  
  const getAreaName = (fPath) => {
   const areaMatch = fPath.match(/Areas[\\/]([^\\/]+)/i)
   return areaMatch ? areaMatch[1] : null
  }
  const areaName = getAreaName(filePath)
  
  const getControllerFromPath = (fPath) => {
   const parts = fPath.split(/[\\/]/)
   const viewsIndex = parts.findIndex(p => p.toLowerCase() === 'views')
   if (viewsIndex !== -1 && parts.length > viewsIndex + 1) {
    return parts[viewsIndex + 1]
   }
   return null
  }
  
  const findAndOpenFile = async (pathsToTry) => {
   console.log('Searching paths:', pathsToTry)
   for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
     console.log('Success: Found file at', p)
     const uri = vscode.Uri.file(p)
     const doc = await vscode.workspace.openTextDocument(uri)
     return await vscode.window.showTextDocument(doc)
    }
   }
   console.log('Error: No files found in searched paths')
   return null
  }
  
  const jumpToMethod = (targetEditor, methodName) => {
   const text = targetEditor.document.getText()
   const methodRegex = new RegExp(`public.*\\s+${methodName}\\s*\\(`, 'i')
   const match = text.match(methodRegex)
   if (match) {
    const targetPosition = targetEditor.document.positionAt(match.index)
    targetEditor.selection = new vscode.Selection(targetPosition, targetPosition)
    targetEditor.revealRange(new vscode.Range(targetPosition, targetPosition), vscode.TextEditorRevealType.InCenter)
   }
  }
  
  const searchAndOpenController = async (controller, action, area) => {
   const paths = []
   const controllerFileName = `${controller}Controller.cs`
   if (area) {
    paths.push(path.join(workspaceFolder, 'Areas', area, 'Controllers', controllerFileName))
   }
   paths.push(path.join(workspaceFolder, 'Controllers', controllerFileName))
   const openEditor = await findAndOpenFile(paths)
   if (openEditor && action) {
    jumpToMethod(openEditor, action)
   }
  }
  
  const resolveCsLogicAndOpenView = async (argsString) => {
   const args = argsString.split(',').map(a => a.trim()).filter(a => a.length > 0)
   let action = ''
   let controller = ''
   if (args.length === 0 || (args.length === 1 && !args[0].startsWith('"') && !args[0].startsWith("'"))) {
    const textUpToCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position))
    const methodMatches = [...textUpToCursor.matchAll(/public.*?\s+([A-Za-z0-9_]+)\s*\(/g)]
    if (methodMatches.length > 0) {
     action = methodMatches[methodMatches.length - 1][1]
    }
    controller = path.basename(filePath, '.cs').replace('Controller', '')
   }
   if (args.length >= 1 && (args[0].startsWith('"') || args[0].startsWith("'"))) {
    action = args[0].replace(/['"]/g, '')
    if (args.length >= 2 && (args[1].startsWith('"') || args[1].startsWith("'"))) {
     controller = args[1].replace(/['"]/g, '')
    } else {
     controller = path.basename(filePath, '.cs').replace('Controller', '')
    }
   }
   if (action && controller) {
    const paths = []
    if (areaName) {
     paths.push(path.join(workspaceFolder, 'Areas', areaName, 'Views', controller, `${action}.cshtml`))
    }
    paths.push(path.join(workspaceFolder, 'Views', controller, `${action}.cshtml`))
    await findAndOpenFile(paths)
   }
  }

  if (isCshtml) {
   const urlActionTwoStringsRegex = /Url\.Action\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/i
   if (urlActionTwoStringsRegex.test(lineText)) {
    console.log('Matched: CSHTML Url.Action (2 strings)')
    const match = urlActionTwoStringsRegex.exec(lineText)
    await searchAndOpenController(match[2], match[1], areaName)
   }
  }

  if (isCshtml) {
   const urlActionOneStringRegex = /Url\.Action\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*[^'"]|\))/i
   const urlActionTwoStringsRegex = /Url\.Action\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/i
   if (urlActionOneStringRegex.test(lineText) && !urlActionTwoStringsRegex.test(lineText)) {
    console.log('Matched: CSHTML Url.Action (1 string + optional objects)')
    const match = urlActionOneStringRegex.exec(lineText)
    const controller = getControllerFromPath(filePath)
    if (controller) {
     await searchAndOpenController(controller, match[1], areaName)
    }
   }
  }

  if (isCshtml) {
   const partialTagRegex = /<partial\s+name\s*=\s*['"]([^'"]+)['"]/i
   if (partialTagRegex.test(lineText)) {
    console.log('Matched: CSHTML Partial Tag')
    const match = partialTagRegex.exec(lineText)
    const partialName = match[1]
    const currentDir = path.dirname(filePath)
    const paths = [path.join(currentDir, `${partialName}.cshtml`)]
    if (areaName) {
     paths.push(path.join(workspaceFolder, 'Areas', areaName, 'Views', 'Shared', `${partialName}.cshtml`))
    }
    paths.push(path.join(workspaceFolder, 'Views', 'Shared', `${partialName}.cshtml`))
    await findAndOpenFile(paths)
   }
  }

  if (isCs) {
   const viewRegex = /View\s*\(([^)]*)\)/i
   if (viewRegex.test(lineText)) {
    console.log('Matched: CS View()')
    const match = viewRegex.exec(lineText)
    await resolveCsLogicAndOpenView(match[1])
   }
  }

  if (isCs) {
   const partialViewRegex = /PartialView\s*\(([^)]*)\)/i
   if (partialViewRegex.test(lineText)) {
    console.log('Matched: CS PartialView()')
    const match = partialViewRegex.exec(lineText)
    await resolveCsLogicAndOpenView(match[1])
   }
  }

  if (isCs) {
   const redirectRegex = /RedirectToAction\s*\(([^)]*)\)/i
   if (redirectRegex.test(lineText)) {
    console.log('Matched: CS RedirectToAction()')
    const match = redirectRegex.exec(lineText)
    await resolveCsLogicAndOpenView(match[1])
   }
  }

  if (isCs) {
   const urlActionCsRegex = /Url\.Action\s*\(([^)]*)\)/i
   if (urlActionCsRegex.test(lineText)) {
    console.log('Matched: CS Url.Action()')
    const match = urlActionCsRegex.exec(lineText)
    await resolveCsLogicAndOpenView(match[1])
   }
  }
 })
 context.subscriptions.push(disposable)
}

module.exports = {
 activate
}