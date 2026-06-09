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

  let match = lineText.match(/([a-zA-Z0-9_]*Actor[a-zA-Z0-9_]*)\.([a-zA-Z0-9_]+)/)
  if (!match) {
   vscode.window.showInformationMessage('Could not find actor message format on this line')
   return
  }

  let actorName = match[1]
  let messageName = match[2]

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

  let text = doc.getText()
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
   newEditor.selection = new vscode.Selection(targetPos, targetPos)
   newEditor.revealRange(range, vscode.TextEditorRevealType.InCenter)
  } else {
   vscode.window.showInformationMessage('Could not find message target for ' + messageName)
  }
 })

 context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
}