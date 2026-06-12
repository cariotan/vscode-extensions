let vscode = require('vscode')
let path = require('path')
let fs = require('fs')

function activate(context) {
 let disposable = vscode.commands.registerCommand('actorNav.go', async function () {
  let editor = vscode.window.activeTextEditor
  if (!editor) {
   return
  }

  let document = editor.document
  let position = editor.selection.active
  let lineText = document.lineAt(position.line).text

  let actorMatch = lineText.match(/([a-zA-Z0-9_]*Actor[a-zA-Z0-9_]*)\.([a-zA-Z0-9_]+)/)
  let recordMatch = lineText.match(/(?:record|class|struct)\s+([a-zA-Z0-9_]+)/)

  if (!actorMatch && !recordMatch) {
   vscode.window.showInformationMessage('Could not find actor message format or record definition on this line')
   return
  }

  if (actorMatch) {
   let actorName = actorMatch[1]
   let messageName = actorMatch[2]

   let currentDir = path.dirname(document.uri.fsPath)
   let parentDir = path.dirname(currentDir)
   
   let actorFolder = path.join(parentDir, 'actors')
   if (!fs.existsSync(actorFolder)) {
    actorFolder = path.join(parentDir, 'Actors')
   }

   let actorFile = path.join(actorFolder, actorName + '.cs')

   if (!fs.existsSync(actorFile)) {
    vscode.window.showErrorMessage('Actor file not found in sibling directory: ' + actorFile)
    return
   }

   let doc = await vscode.workspace.openTextDocument(actorFile)
   let newEditor = await vscode.window.showTextDocument(doc)

   findAndNavigateToHandler(newEditor, doc, messageName)
  } else if (recordMatch) {
   let messageName = recordMatch[1]
   findAndNavigateToHandler(editor, document, messageName)
  }
 })

 context.subscriptions.push(disposable)
}

function findAndNavigateToHandler(editor, document, messageName) {
 let text = document.getText()
 let lines = text.split('\n')
 let targetLine = -1
 
 let regex = new RegExp('(?:Receive|Command|Recover)(?:Async)?< *' + messageName + ' *>')

 for (let i = 0; i < lines.length; i++) {
  if (regex.test(lines[i])) {
   targetLine = i
   break
  }
 }

 if (targetLine !== -1) {
  let targetPos = new vscode.Position(targetLine, 0)
  let range = new vscode.Range(targetPos, targetPos)
  editor.selection = new vscode.Selection(targetPos, targetPos)
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
 } else {
  vscode.window.showInformationMessage('Could not find message target for ' + messageName)
 }
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
}