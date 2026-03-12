const vscode = require('vscode')
const path = require('path')
const fs = require('fs')

function activate(context) {
 let disposable = vscode.commands.registerCommand('controller-action-jumper.jump', async () => {
  const editor = vscode.window.activeTextEditor
  if (!editor) return

  const range = editor.document.getWordRangeAtPosition(editor.selection.active)
  const lineText = editor.document.lineAt(editor.selection.active.line).text
  const filePath = editor.document.fileName
  const fileName = path.basename(filePath)
  const isController = fileName.endsWith('Controller.cs')

  let word = range ? editor.document.getText(range) : ''
  let targetController = null

  // 1. EXTRACT TARGET WORD & CONTROLLER
  if (lineText.includes('<partial')) {
   const match = lineText.match(/name=['"]([^'"]+)['"]/)
   if (match) word = match[1]
  } else if (lineText.includes('PartialView(')) {
   const match = lineText.match(/PartialView\(['"]([^'"]+)['"]/)
   if (match) word = match[1]
  } else if (lineText.includes('Url.Action(')) {
   const match = lineText.match(/Url\.Action\(['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/)
   if (match) {
    word = match[1] // Action
    if (match[2]) targetController = match[2] // Controller
   }
  }

  if (!word) return

  const openFile = async (targetPath, searchWord) => {
   const doc = await vscode.workspace.openTextDocument(targetPath)
   const text = doc.getText()
   const index = searchWord ? text.indexOf(searchWord) : 0
   const pos = doc.positionAt(index !== -1 ? index : 0)
   const newEditor = await vscode.window.showTextDocument(doc, { preserveFocus: false })
   newEditor.selection = new vscode.Selection(pos, pos)
   newEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  }

  // 2. SEARCH LOGIC
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
  const searchPaths = []

  // Resolve context for Controller/Area
  const controllerDir = isController ? path.dirname(filePath) : ''
  const parts = filePath.split(path.sep)
  const areasIdx = parts.lastIndexOf("Areas")
  const viewsIdx = parts.lastIndexOf("Views")
  const isArea = areasIdx !== -1 && (isController ? path.basename(path.dirname(controllerDir)) === 'Areas' : viewsIdx > areasIdx)

  if (targetController) {
   // Url.Action with 2 params: Find specific controller folder
   let baseViews
   if (isArea) {
    baseViews = path.join(parts.slice(0, areasIdx + 2).join(path.sep), "Views")
   } else {
    // Try to find the root Views folder
    const rootViewsIdx = parts.lastIndexOf("Views")
    baseViews = rootViewsIdx !== -1 ? parts.slice(0, rootViewsIdx + 1).join(path.sep) : path.join(workspaceRoot, "Views")
   }
   searchPaths.push(path.join(baseViews, targetController))
   searchPaths.push(path.join(baseViews, "Shared"))
  } else if (isController || word.startsWith('_') || lineText.includes('<partial')) {
   // Local Controller folder or Partial logic
   const currentControllerName = fileName.replace('Controller.cs', '')
   let baseViews
   if (isArea) {
    const areaPath = parts.slice(0, areasIdx + 2).join(path.sep)
    baseViews = path.join(areaPath, "Views")
   } else {
    baseViews = path.join(workspaceRoot, "Views")
   }
   
   if (isController) searchPaths.push(path.join(baseViews, currentControllerName))
   else searchPaths.push(path.dirname(filePath)) // .cshtml local folder
   
   searchPaths.push(path.join(baseViews, "Shared"))
  }

  // Global fallback
  searchPaths.push(path.join(workspaceRoot, "Views", "Shared"))

  for (const searchDir of searchPaths) {
   if (!fs.existsSync(searchDir)) continue
   const targetFile = word.endsWith('.cshtml') ? word : `${word}.cshtml`
   const fullPath = path.join(searchDir, targetFile)
   
   if (fs.existsSync(fullPath)) {
    await openFile(fullPath)
    return
   }
  }

  // 3. FALLBACK: STANDARD JUMP (VIEW -> CONTROLLER)
  if (!isController && fileName.endsWith('.cshtml')) {
   const viewsIndex = parts.lastIndexOf("Views")
   if (viewsIndex === -1) return
   const folderName = parts[viewsIndex + 1]
   let controllerPath = (isArea) 
    ? path.join(parts.slice(0, areasIdx + 2).join(path.sep), "Controllers", `${folderName}Controller.cs`)
    : path.join(parts.slice(0, viewsIndex).join(path.sep), "Controllers", `${folderName}Controller.cs`)

   if (fs.existsSync(controllerPath)) {
    await openFile(controllerPath, word)
   }
  }
 })
 context.subscriptions.push(disposable)
}

exports.activate = activate