let vscode = require('vscode')

function activate(context)
{
 let disposable = vscode.commands.registerCommand('change-to-triple-quotes.convertToTripleQuotes', function ()
 {
  let editor = vscode.window.activeTextEditor
  if(!editor)
  {
   return
  }

  let document = editor.document
  let position = editor.selection.active
  let lineText = document.lineAt(position.line).text
  let charPos = position.character

  let regex = /("{1,3})([\s\S]*?)("{1,3})/g
  let match

  while((match = regex.exec(lineText)) !== null)
  {
   let start = match.index
   let end = match.index + match[0].length

   if(charPos >= start && charPos <= end)
   {
    let openQuotes = match[1]
    let content = match[2]
    let closeQuotes = match[3]

    if(openQuotes === '"""' && closeQuotes === '"""')
    {
     return
    }

    let range = new vscode.Range(
     position.line, start,
     position.line, end
    )

    editor.edit(editBuilder =>
    {
     editBuilder.replace(range, '"""' + content + '"""')
    })
    break
   }
  }
 })

 context.subscriptions.push(disposable)
}

function deactivate()
{
}

module.exports = {
 activate,
 deactivate
}