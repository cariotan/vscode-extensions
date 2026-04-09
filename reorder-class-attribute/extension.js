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

  let config = vscode.workspace.getConfiguration('reorderClassAttribute');
  let hardcodedList = config.get('priorityAttributes');

  if(!hardcodedList || !Array.isArray(hardcodedList))
  {
   hardcodedList = ['id', 'type', 'value', 'src', 'alt', 'name'];
  }

  // UPDATED: Safely parses HTML tags while ignoring '>' if it is wrapped in quotes or backticks
  let tagRegex = /<[a-zA-Z0-9\-]+(?:[^>'"`]|"[^"]*"|'[^']*'|`[^`]*`)*>/g;

  let newText = text.replace(tagRegex, function (match)
  {
   let lines = match.split('\n');

   let classRegex = /^class\s*=/i;
   let bindClassRegex = /^:class\s*=/i;
   let styleRegex = /^style\s*=/i;

   let classLine = null;
   let bindClassLine = null;
   let styleLine = null;

   // 1. Extract class, :class, and style from the tag
   // We loop backwards so splicing out lines doesn't shift the index of upcoming lines
   for(let i = lines.length - 1; i >= 1; i--)
   {
    let trimmed = lines[i].trim();
    if(classRegex.test(trimmed))
    {
     classLine = lines.splice(i, 1)[0];
    }
    else if(bindClassRegex.test(trimmed))
    {
     bindClassLine = lines.splice(i, 1)[0];
    }
    else if(styleRegex.test(trimmed))
    {
     styleLine = lines.splice(i, 1)[0];
    }
   }

   // 2. If absolutely none of those three exist, return the tag unmodified
   if(!classLine && !bindClassLine && !styleLine)
   {
    return match;
   }

   let regexParts = hardcodedList.map(function (item)
   {
    if(item.includes('*'))
    {
     return item.replace(/\*/g, '[a-zA-Z0-9\\-]+');
    }
    return item;
   });

   let attrRegex = new RegExp('^(' + regexParts.join('|') + ')\\s*=', 'i');
   let insertIndex = 1; // Default position is right beneath the opening <tag> name

   // 3. Scan the remaining lines to find the lowest priority attribute to insert beneath
   for(let i = lines.length - 1; i >= 1; i--)
   {
    if(attrRegex.test(lines[i].trim()))
    {
     insertIndex = i + 1;
     break;
    }
   }

   // 4. Batch them in your requested order: :class, then class, then style
   let itemsToAdd = [];
   if(bindClassLine)
   {
    itemsToAdd.push(bindClassLine);
   }
   if(classLine)
   {
    itemsToAdd.push(classLine);
   }
   if(styleLine)
   {
    itemsToAdd.push(styleLine);
   }

   // Insert them all at the computed index
   lines.splice(insertIndex, 0, ...itemsToAdd);

   return lines.join('\n');
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