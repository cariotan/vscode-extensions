let vscode = require('vscode');

function formatHTML(html) {
 let result = [];
 let indentLevel = 0;
 let indentChar = '\t'; 
 let svgDepth = 0; 
 
 let tokens = html.match(/(<script\b[^>]*>[\s\S]*?<\/script>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?[a-zA-Z0-9\-]+[^>]*>|[^<]+)/gi);
 
 if (!tokens) return html;

 let voidElements = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

 for (let i = 0; i < tokens.length; i++) {
  let token = tokens[i].trim();
  if (!token) continue;

  if (token.toLowerCase().startsWith('<script')) {
   result.push(getIndent(indentLevel, indentChar) + token);
  } else if (token.startsWith('<!--') || token.toUpperCase().startsWith('<!DOCTYPE')) {
   result.push(getIndent(indentLevel, indentChar) + token);
  } else if (token.startsWith('</')) {
   
   indentLevel = Math.max(0, indentLevel - 1);
   if (token.toLowerCase().startsWith('</svg')) {
    svgDepth = Math.max(0, svgDepth - 1);
   }
   
   result.push(getIndent(indentLevel, indentChar) + token);
   
  } else if (token.startsWith('<')) {
   let isSelfClosing = token.endsWith('/>');
   let tagInner = token.slice(1, isSelfClosing ? -2 : -1).trim();
   
   let tagNameMatch = tagInner.match(/^([a-zA-Z0-9\-:]+)/);
   let tagName = tagNameMatch ? tagNameMatch[1] : '';
   let attrString = tagInner.substring(tagName.length).trim();
   
   let attrRegex = /([a-zA-Z0-9\-:@_.]+)(?:\s*=\s*(?:(?:"([^"]*)")|(?:'([^']*)')|([^>\s]+)))?/g;
   let match;
   let attrs = [];
   
   while ((match = attrRegex.exec(attrString)) !== null) {
    let attrName = match[1];
    let attrVal = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
    if (attrVal !== undefined) {
     attrs.push(attrName + "='" + attrVal + "'");
    } else {
     attrs.push(attrName);
    }
   }

   let isSvgTag = tagName.toLowerCase() === 'svg';

   if (isSvgTag) {
    let classIndex = attrs.findIndex(a => a.startsWith("class=") || a === "class");
    if (classIndex > 0) {
     let classAttr = attrs.splice(classIndex, 1)[0];
     attrs.unshift(classAttr);
    }
   }

   // LOOKAHEAD LOGIC: Check if this tag is completely empty
   let isEmpty = false;
   let closingTagText = '';
   if (!isSelfClosing && !voidElements.includes(tagName.toLowerCase())) {
    let lookAheadIndex = i + 1;
    
    // Skip any pure whitespace between the tags
    while (lookAheadIndex < tokens.length && tokens[lookAheadIndex].trim() === '') {
     lookAheadIndex++;
    }
    
    // Check if the next non-empty token is the exact matching closing tag
    if (lookAheadIndex < tokens.length) {
     let nextToken = tokens[lookAheadIndex].trim();
     if (nextToken.startsWith('</')) {
      let closeMatch = nextToken.match(/^<\/([a-zA-Z0-9\-:]+)/);
      let closeName = closeMatch ? closeMatch[1] : '';
      if (closeName.toLowerCase() === tagName.toLowerCase()) {
       isEmpty = true;
       closingTagText = nextToken;
       i = lookAheadIndex; // Fast-forward the main loop so we don't process the closing tag again
      }
     }
    }
   }

   let formattedTag = '';
   let baseIndent = getIndent(indentLevel, indentChar);
   let disableStacking = isSvgTag || svgDepth > 0;
   
   if (attrs.length >= 2 && !disableStacking) {
    let attrIndent = baseIndent + indentChar;
    formattedTag = baseIndent + '<' + tagName + '\n';
    for (let j = 0; j < attrs.length; j++) {
     formattedTag += attrIndent + attrs[j];
     if (j < attrs.length - 1) formattedTag += '\n';
    }
    formattedTag += isSelfClosing ? '\n' + baseIndent + '/>' : '>';
   } else if (attrs.length > 0) {
    formattedTag = baseIndent + '<' + tagName + ' ' + attrs.join(' ') + (isSelfClosing ? ' />' : '>');
   } else {
    formattedTag = baseIndent + '<' + tagName + (isSelfClosing ? ' />' : '>');
   }

   // If the tag was empty, append the closing tag directly to the end of the opening block
   if (isEmpty) {
    formattedTag += closingTagText;
   }

   result.push(formattedTag);

   // Only increase indent level if it is NOT an empty element
   if (!isSelfClosing && !voidElements.includes(tagName.toLowerCase()) && !isEmpty) {
    indentLevel++;
   }

   // Keep track of SVG wrapping specifically, ignoring empty SVGs
   if (isSvgTag && !isSelfClosing && !isEmpty) {
    svgDepth++;
   }

  } else {
   let textLines = token.split(/\r?\n/);
   for (let k = 0; k < textLines.length; k++) {
    let line = textLines[k].trim();
    if (line) result.push(getIndent(indentLevel, indentChar) + line);
   }
  }
 }

 return result.join('\n');
}

function getIndent(level, char) {
 let res = '';
 for (let i = 0; i < level; i++) res += char;
 return res;
}

function activate(context) {
 let disposable = vscode.commands.registerCommand('html-formatter.formatSelection', function () {
  let editor = vscode.window.activeTextEditor;
  if (!editor) return;

  let selection = editor.selection;
  let text = editor.document.getText(selection);
  
  if (!text) return;

  let formattedText = formatHTML(text);

  editor.edit(function (editBuilder) {
   editBuilder.replace(selection, formattedText);
  });
 });

 context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
};