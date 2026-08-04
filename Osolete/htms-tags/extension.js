const vscode = require('vscode')

function activate(context) {
  let disposable = vscode.commands.registerCommand('formatTagsContent', function () {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const doc = editor.document
    const text = doc.getText()

    let formatted = text
      // Match inline content between tags and indent properly
      .replace(/(^[ \t]*)(<(\w+)[^>]*>)([^<>\n]+)(<\/\3>)/gm, (match, indent, openTag, tag, content, closeTag) => {
        const innerIndent = indent + '\t'
        return `${indent}${openTag}\n${innerIndent}${content.trim()}\n${indent}${closeTag}`
      })
      // Split trailing text after closing tag
      .replace(/(<\/\w+>)([^\s<])/g, (match, tag, text) => {
        return `${tag}\n${text}`
      })

    // Additional pass: move closing tags like </tag> to a new line with one less indent,
    // but only if the line contains visible content before the tag
    formatted = formatted.replace(/^([ \t]*)([^\s<][^\n<>]*?)\s*(<\/\w+>)\s*$/gm, (match, indent, content, closeTag) => {
      if (!content.trim()) return match // don't change if content is empty or just whitespace
      const newIndent = indent.length > 1 ? indent.slice(0, -1) : ''
      return `${indent}${content.trim()}\n${newIndent}${closeTag}`
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

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
