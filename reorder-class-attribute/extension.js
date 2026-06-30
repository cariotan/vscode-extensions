let vscode = require('vscode');

function activate(context)
{
 let disposable = vscode.commands.registerCommand('reorder-class-attribute.reorder', function ()
 {
  let editor = vscode.window.activeTextEditor;
  if(!editor)
  {
   return;
  }

  let document = editor.document;
  let text = document.getText();
  
  // Detect if the document uses CRLF or LF
  let eol = text.includes('\r\n') ? '\r\n' : '\n';

  let tagRegex = /<[a-zA-Z0-9\-]+(?:[^>'"`]|"[^"]*"|'[^']*'|`[^`]*`)*>/g;

  let newText = text.replace(tagRegex, function (match)
  {
   let closingMatch = match.match(/(\s*\/?\>)$/);
   let closing = closingMatch ? closingMatch[1] : '>';
   let innerTag = match.slice(0, match.length - closing.length);

   // Split handling both \r\n and \n to avoid trailing carriage returns
   let lines = innerTag.split(/\r?\n/);

   lines = lines.filter(function (line)
   {
    return line.trim().length > 0;
   });

   let classRegex = /^class\s*=/i;
   let styleRegex = /^style\s*=/i;

   let classLine = null;
   let styleLine = null;

   for(let i = lines.length - 1; i >= 1; i--)
   {
    let trimmed = lines[i].trim();
    if(classRegex.test(trimmed))
    {
     classLine = lines.splice(i, 1)[0];
    }
    else if(styleRegex.test(trimmed))
    {
     styleLine = lines.splice(i, 1)[0];
    }
   }

   if(!classLine && !styleLine)
   {
    return match;
   }

   if(classLine)
   {
    lines.push(classLine);
   }
   if(styleLine)
   {
    lines.push(styleLine);
   }

   // Rejoin using the detected EOL character
   return lines.join(eol) + closing;
  });

  let fullRange = new vscode.Range(
   document.positionAt(0),
   document.positionAt(text.length)
  );

  editor.edit(function (editBuilder)
  {
   editBuilder.replace(fullRange, newText);
  });
 });

 context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = {
 activate,
 deactivate
};