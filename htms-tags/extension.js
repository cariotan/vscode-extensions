const vscode = require('vscode')

function activate(context) {
  let disposable = vscode.commands.registerCommand('formatTagsContent', function () {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const doc = editor.document
    const text = doc.getText()

    const formatted = text
      // Match inline content between tags and indent properly
      .replace(/(^[ \t]*)(<(\w+)[^>]*>)([^<>\n]+)(<\/\3>)/gm, (match, indent, openTag, tag, content, closeTag) => {
        const innerIndent = indent + '\t'
        return `${indent}${openTag}\n${innerIndent}${content.trim()}\n${indent}${closeTag}`
      })
      // Split trailing text after closing tag
      .replace(/(<\/\w+>)([^\s<])/g, (match, tag, text) => {
        return `${tag}\n${text}`
      })

    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(text.length)
    )

    editor.edit(editBuilder => {
      editBuilder.replace(fullRange, formatted)
    })
  })

  context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
}
