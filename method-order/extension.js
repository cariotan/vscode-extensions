let vscode = require('vscode')

function activate(context)
{
 let disposable = vscode.commands.registerCommand('csharp-method-sorter.sortMethods', function ()
 {
  let editor = vscode.window.activeTextEditor
  if(!editor)
  {
   return
  }

  let document = editor.document
  let text = document.getText()
  let isCRLF = text.includes('\r\n')
  let newline = isCRLF ? '\r\n' : '\n'
  let lines = text.split(/\r?\n/)

  let methods = []
  let i = 0

  while(i < lines.length)
  {
   let line = lines[i]
   let match = line.match(/^([ \t]*)(public|private|protected|internal)?\s*(?:(?:static|async|override|virtual|new|sealed|partial|unsafe)\s+)*[\w<>\[\]\?]+\s+([\w]+)\s*\(/)

   // FIX: Removed !line.includes('=') so methods with default parameters are captured.
   if(match && !line.includes('class ') && !line.includes('struct ') && !line.includes('record ') && !line.includes('interface '))
   {
    let visibility = match[2] || 'private'
    let methodName = match[3]

    let startIdx = i
    while(startIdx > 0)
    {
     let prevLine = lines[startIdx - 1].trim()
     if(prevLine.startsWith('///') || prevLine.startsWith('//') || prevLine.startsWith('['))
     {
      startIdx--
     }
     else
     {
      break
     }
    }

    let endIdx = i
    let braceCount = 0
    let foundOpenBrace = false

    while(endIdx < lines.length)
    {
     let lineText = lines[endIdx]
     if(lineText.includes('{'))
     {
      braceCount += (lineText.match(/{/g) || []).length
      foundOpenBrace = true
     }
     if(lineText.includes('}'))
     {
      braceCount -= (lineText.match(/}/g) || []).length
     }
     
     if(foundOpenBrace && braceCount === 0)
     {
      break
     }
     if(!foundOpenBrace && (lineText.includes('=>') || lineText.includes(';')))
     {
      if(lineText.includes(';'))
      {
       break
      }
     }
     endIdx++
    }

    if(endIdx < lines.length)
    {
     methods.push({
      visibility: visibility,
      name: methodName,
      startLine: startIdx,
      endLine: endIdx,
      lines: lines.slice(startIdx, endIdx + 1)
     })
     i = endIdx + 1
     continue
    }
   }
   i++
  }

  if(methods.length === 0)
  {
   vscode.window.showInformationMessage('No sortable C# methods found.')
   return
  }

  methods.sort((a, b) =>
  {
   let visScore = { 'public': 1, 'protected': 2, 'internal': 3, 'private': 4 }
   let scoreA = visScore[a.visibility] || 4
   let scoreB = visScore[b.visibility] || 4

   if(scoreA !== scoreB)
   {
    return scoreA - scoreB
   }
   return a.name.localeCompare(b.name)
  })

  let sortedText = methods.map(m => m.lines.join(newline)).join(newline + newline)

  let newDocLines = []
  let methodRanges = methods.map(m => ({ start: m.startLine, end: m.endLine }))
  methodRanges.sort((a, b) =>
  {
   return a.start - b.start
  })

  let currentLine = 0
  let isFirstMethodPlacement = false

  while(currentLine < lines.length)
  {
   let inMethodRange = methodRanges.find(r =>
   {
    return currentLine >= r.start && currentLine <= r.end
   })

   if(inMethodRange)
   {
    if(!isFirstMethodPlacement)
    {
     newDocLines.push("___INSERT_METHODS_HERE___")
     isFirstMethodPlacement = true
    }
    currentLine = inMethodRange.end + 1
   }
   else
   {
    newDocLines.push(lines[currentLine])
    currentLine++
   }
  }

  let finalDocText = newDocLines.join(newline).replace("___INSERT_METHODS_HERE___", sortedText)
  
  finalDocText = finalDocText.replace(/(\r?\n\s*){3,}/g, newline + newline)
  finalDocText = finalDocText.replace(/(?:\r?\n[ \t]*)+\r?\n([ \t]*})/g, newline + '$1')

  editor.edit(editBuilder =>
  {
   let fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(text.length)
   )
   editBuilder.replace(fullRange, finalDocText)
  })
 })

 context.subscriptions.push(disposable)
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
}