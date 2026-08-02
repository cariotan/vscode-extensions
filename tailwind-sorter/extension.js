// extension.js
const vscode = require('vscode');

// Your custom Tailwind class order (modify this array as per your preferences)
const CLASS_ORDER = [
    'justify-self', 'self', 'container', 'col', 'row', 'order',
				'flex', 'grid', '[grid-template', 'inline', 'visible',
    'justify', 'items', 'place', 'content',
    'gap', 'space',
    'hidden', 'block', 'table',
    'static', 'relative', 'absolute', 'fixed', 'sticky', 'z', 'inset', 'top', 'bottom', 'left', 'right',
    'animate', 'transition', 'origin', 'translate', 'duration', 'opacity', 'scale', 'rotate', 'skew',
    'backdrop',
    'm', 'mx', 'my', 'ml', 'mr', 'mt', 'mb',
    'rounded', 'outline', 'ring', 'border',
    'list',
    'w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'size',
    'appearance',
    'bg', 'from', 'to', 'clip',
    'p', 'px', 'py', 'pl', 'pr', 'pt', 'pb',
    'accent',
    'text-center', 'text-left', 'text-right',
    'text-xs', 'text-sm', 'text-md', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl',
    'text', 'font', 'leading', 'tracking', 'uppercase', 'lowercase', 'capitalize', 'normal-case',
    'overflow', 'shadow',
    'cursor', 'select', 'scroll',
    'hover:', 'focus:', 'active:',
    'data-',
    'sm:', 'md:', 'ml:', 'lg:', 'lr:', 'xl:', '2xl:',
    'max-sm:', 'max-md:', 'max-ml:', 'max-lg:', 'max-lr:', 'max-xl:', 'max-2xl:',
    'debug'
];

function sortTailwindClasses(classString) {
 if (!classString) return classString;

 let hasBackticks = classString.trim().startsWith('`') && classString.trim().endsWith('`');
 if (hasBackticks) {
  classString = classString.trim().slice(1, -1);
 }

 // Debug: Log the raw input
 console.log('Input to sortTailwindClasses:', classString);

 // Use regex to match full @(...) expressions or single classes
 let classRegex = /(@\([^)]*\))|\S+/g;
 let classes = classString.match(classRegex) || [];
 
 // Debug: Log tokenized classes
 console.log('Tokenized classes:', classes);
 
 // Separate classes into groups
 let orderedClasses = [];    // Non-prefixed classes
 let unknownClasses = [];    // Unknown classes (not in CLASS_ORDER)
 let hoverFocusGroups = {};  // hover: and focus: prefixed classes
 let dataGroups = {};        // data-[] prefixed classes
 let breakpointGroups = {};  // Breakpoint prefixed classes (sm:, md:, etc.)
 let razorClasses = [];      // Razor @(...) expressions
 
 // Define boundaries in CLASS_ORDER
 let hoverFocusStart = CLASS_ORDER.indexOf('hover:');
 let dataStart = CLASS_ORDER.indexOf('data-');
 let breakpointStart = CLASS_ORDER.indexOf('sm:');
 let nonPrefixedOrder = CLASS_ORDER.slice(0, hoverFocusStart);
 let hoverFocusPrefixes = CLASS_ORDER.slice(hoverFocusStart, dataStart);
 let dataPrefixes = CLASS_ORDER.slice(dataStart, breakpointStart);
 let breakpointPrefixes = CLASS_ORDER.slice(breakpointStart);
 
 // Categorize classes
 classes.forEach(cls => {
  console.log('Processing token:', cls);
  // Check for Razor @(...) syntax first
  if (cls.startsWith('@(')) {
   razorClasses.push(cls);
   console.log('Moved to razorClasses:', cls);
  } else {
   let isBreakpoint = breakpointPrefixes.some(p => cls.startsWith(p));
   if (isBreakpoint) {
    let prefix = breakpointPrefixes.find(p => cls.startsWith(p));
    if (!breakpointGroups[prefix]) breakpointGroups[prefix] = [];
    breakpointGroups[prefix].push(cls);
   } else {
    let isData = dataPrefixes.some(p => cls.startsWith(p));
    if (isData) {
     let prefix = cls.split(':')[0] + ':'; // Extract full prefix like "data-[state=active]:"
     if (!dataGroups[prefix]) dataGroups[prefix] = [];
     dataGroups[prefix].push(cls);
    } else {
     let isHoverFocus = hoverFocusPrefixes.some(p => cls.startsWith(p));
     if (isHoverFocus) {
      let prefix = hoverFocusPrefixes.find(p => cls.startsWith(p));
      if (!hoverFocusGroups[prefix]) hoverFocusGroups[prefix] = [];
      hoverFocusGroups[prefix].push(cls);
     } else {
      let isNegative = cls.startsWith('-');
      let baseCls = isNegative ? cls.slice(1) : cls;
      let prefix = nonPrefixedOrder.find(p => baseCls.startsWith(p + '-') || baseCls === p) || '';
      if (prefix) {
       orderedClasses.push(cls);
      } else {
       unknownClasses.push(cls);
      }
     }
    }
   }
  }
 });
 
 // Debug: Log all groups before sorting
 console.log('Ordered:', orderedClasses);
 console.log('Unknown:', unknownClasses);
 console.log('Hover/Focus:', hoverFocusGroups);
 console.log('Data:', dataGroups);
 console.log('Breakpoints:', breakpointGroups);
 console.log('Razor:', razorClasses);
 
 // Sort ordered classes based on non-prefixed CLASS_ORDER
 orderedClasses.sort((a, b) => {
  let aIsNegative = a.startsWith('-');
  let bIsNegative = b.startsWith('-');
  let aBase = aIsNegative ? a.slice(1) : a;
  let bBase = bIsNegative ? b.slice(1) : b;
  let aPrefix = nonPrefixedOrder.find(prefix => aBase.startsWith(prefix + '-') || aBase === prefix) || aBase;
  let bPrefix = nonPrefixedOrder.find(prefix => bBase.startsWith(prefix + '-') || bBase === prefix) || bBase;
  let prefixOrder = nonPrefixedOrder.indexOf(aPrefix) - nonPrefixedOrder.indexOf(bPrefix);
  
  if (prefixOrder !== 0) return prefixOrder;
  if (aIsNegative && !bIsNegative) return 1;
  if (!aIsNegative && bIsNegative) return -1;
  return a.localeCompare(b);
 });
 
 // Sort unknown classes alphabetically
 unknownClasses.sort((a, b) => a.localeCompare(b));
 
 // Sort hover/focus groups
 let sortedHoverFocusClasses = [];
 hoverFocusPrefixes.forEach(prefix => {
  if (hoverFocusGroups[prefix]) {
   hoverFocusGroups[prefix].sort((a, b) => {
    let aBase = a.replace(prefix, '');
    let bBase = b.replace(prefix, '');
    let aIsNegative = aBase.startsWith('-');
    let bIsNegative = bBase.startsWith('-');
    let aBaseNoNeg = aIsNegative ? aBase.slice(1) : aBase;
    let bBaseNoNeg = bIsNegative ? bBase.slice(1) : bBase;
    let aPrefix = nonPrefixedOrder.find(p => aBaseNoNeg.startsWith(p + '-') || aBaseNoNeg === p) || aBaseNoNeg;
    let bPrefix = nonPrefixedOrder.find(p => bBaseNoNeg.startsWith(p + '-') || bBaseNoNeg === p) || bBaseNoNeg;
    let aIndex = nonPrefixedOrder.indexOf(aPrefix);
    let bIndex = nonPrefixedOrder.indexOf(bPrefix);
    
    if (aIndex === -1 && bIndex === -1) return aBase.localeCompare(bBase);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    if (aIndex !== bIndex) return aIndex - bIndex;
    if (aIsNegative && !bIsNegative) return 1;
    if (!aIsNegative && bIsNegative) return -1;
    return aBase.localeCompare(bBase);
   });
   sortedHoverFocusClasses.push(...hoverFocusGroups[prefix]);
  }
 });
 
 // Sort data-[] groups
 let sortedDataClasses = [];
 Object.keys(dataGroups).sort().forEach(prefix => {
  if (dataGroups[prefix]) {
   dataGroups[prefix].sort((a, b) => {
    let aBase = a.replace(prefix, '');
    let bBase = b.replace(prefix, '');
    let aIsNegative = aBase.startsWith('-');
    let bIsNegative = bBase.startsWith('-');
    let aBaseNoNeg = aIsNegative ? aBase.slice(1) : aBase;
    let bBaseNoNeg = bIsNegative ? bBase.slice(1) : bBase;
    let aPrefix = nonPrefixedOrder.find(p => aBaseNoNeg.startsWith(p + '-') || aBaseNoNeg === p) || aBaseNoNeg;
    let bPrefix = nonPrefixedOrder.find(p => bBaseNoNeg.startsWith(p + '-') || bBaseNoNeg === p) || bBaseNoNeg;
    let aIndex = nonPrefixedOrder.indexOf(aPrefix);
    let bIndex = nonPrefixedOrder.indexOf(bPrefix);
    
    if (aIndex === -1 && bIndex === -1) return aBase.localeCompare(bBase);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    if (aIndex !== bIndex) return aIndex - bIndex;
    if (aIsNegative && !bIsNegative) return 1;
    if (!aIsNegative && bIsNegative) return -1;
    return aBase.localeCompare(bBase);
   });
   sortedDataClasses.push(...dataGroups[prefix]);
  }
 });
 
 // Sort breakpoint groups
 let sortedBreakpointClasses = [];
 breakpointPrefixes.forEach(prefix => {
  if (breakpointGroups[prefix]) {
   breakpointGroups[prefix].sort((a, b) => {
    let aBase = a.replace(prefix, '');
    let bBase = b.replace(prefix, '');
    let aIsNegative = aBase.startsWith('-');
    let bIsNegative = bBase.startsWith('-');
    let aBaseNoNeg = aIsNegative ? aBase.slice(1) : aBase;
    let bBaseNoNeg = bIsNegative ? bBase.slice(1) : bBase;
    let aPrefix = nonPrefixedOrder.find(p => aBaseNoNeg.startsWith(p + '-') || aBaseNoNeg === p) || aBaseNoNeg;
    let bPrefix = nonPrefixedOrder.find(p => bBaseNoNeg.startsWith(p + '-') || bBaseNoNeg === p) || bBaseNoNeg;
    let aIndex = nonPrefixedOrder.indexOf(aPrefix);
    let bIndex = nonPrefixedOrder.indexOf(bPrefix);
    
    if (aIndex === -1 && bIndex === -1) return aBase.localeCompare(bBase);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    if (aIndex !== bIndex) return aIndex - bIndex;
    if (aIsNegative && !bIsNegative) return 1;
    if (!aIsNegative && bIsNegative) return -1;
    return aBase.localeCompare(bBase);
   });
   sortedBreakpointClasses.push(...breakpointGroups[prefix]);
  }
 });
 
 // Debug: Log final output before joining
 let finalOutput = [...orderedClasses, ...unknownClasses, ...sortedHoverFocusClasses, ...sortedDataClasses, ...sortedBreakpointClasses, ...razorClasses];
 console.log('Final output array:', finalOutput);
 
 // Combine: ordered -> unknown -> hover/focus -> data -> breakpoints -> razor
 let sortedString = finalOutput.join(' ');
 return hasBackticks ? '`' + sortedString + '`' : sortedString;
}

function activate(context) {
    // Register the command
    let disposable = vscode.commands.registerCommand('tailwind-sorter.sortClasses', () => {
        const editor = vscode.window.activeTextEditor;
        
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;

            // If there's a selection, sort only that text
            if (!selection.isEmpty) {
                const text = document.getText(selection);
                console.log('Selection mode - Raw input:', text);
                const sorted = sortTailwindClasses(text);
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, sorted);
                });
            } else {
                // Otherwise sort all class attributes in the document
                const text = document.getText();
                console.log('Full document mode - Raw input:', text);
                const newText = text.replace(
                    /class(Name)?=(["'])((?:[^"']|\s|\([^)]*\))*)\2/g,
                    (match, className, quote, classes) => {
                        console.log('Full document mode - Captured classes:', classes);
                        const sortedClasses = sortTailwindClasses(classes);
                        console.log('Full document mode - Sorted classes:', sortedClasses);
                        return `class${className || ''}=${quote}${sortedClasses}${quote}`;
                    }
                );
                editor.edit(editBuilder => {
                    editBuilder.replace(
                        new vscode.Range(0, 0, document.lineCount, 0),
                        newText
                    );
                });
            }
        }
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};