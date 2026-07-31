const vscode = require("vscode");

function activate(context) {
 let cachedFiles = [];

 vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**}").then(files => {
  console.log(`[CustomSearch] Cached ${files.length} workspace files.`);
  cachedFiles = files;
 });

 let disposable = vscode.commands.registerCommand("customSearch.start", () => {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = "Type to search files, or add # to search symbols...";

  quickPick.onDidChangeValue(async (value) => {
   console.log(`[CustomSearch] Input changed: "${value}"`);
   const hasSymbolTrigger = value.includes("#");
   // Replace # with a space so "ind#holler" becomes two terms: "ind" and "holler"
   const cleanQuery = value.replaceAll("#", " ");

   if (hasSymbolTrigger) {
    quickPick.busy = true;
    try {
     const terms = cleanQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
     
     // 1. Query the provider with only the first term to cast a wide net.
     // Passing all terms might cause the language server to return nothing.
     const providerQuery = terms[0] || "";
     console.log(`[CustomSearch] Triggering workspace symbol search for: "${providerQuery}"`);
     
     const symbols = await vscode.commands.executeCommand(
      "vscode.executeWorkspaceSymbolProvider",
      providerQuery
     );

     if (symbols && symbols.length > 0) {
      // 2. Build the same regex pattern used for file searching
      const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      const regex = new RegExp(pattern, "i");

      // 3. Filter symbols combining the symbol name, container, and file path
      const filteredSymbols = symbols
       .filter(sym => {
        const relativePath = vscode.workspace.asRelativePath(sym.location.uri);
        const searchableTarget = `${sym.name} ${sym.containerName || ""} ${relativePath}`;
        return regex.test(searchableTarget);
       })
       .slice(0, 100);

      const items = filteredSymbols.map(sym => ({
       label: `$(symbol-misc) ${sym.name}`,
       description: vscode.workspace.asRelativePath(sym.location.uri),
       detail: sym.containerName,
       alwaysShow: true,
       symbolData: sym
      }));

      quickPick.items = items;
      console.log(`[CustomSearch] QuickPick Symbol Items set (${items.length})`);
     } else {
      console.warn("[CustomSearch] No symbols returned from symbol provider.");
      quickPick.items = [];
     }
    } catch (err) {
     console.error("[CustomSearch] Symbol search error:", err);
     quickPick.items = [];
    } finally {
     quickPick.busy = false;
    }
   } else {
    const terms = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    const regex = new RegExp(pattern, "i");

    const filtered = cachedFiles
     .filter(file => {
      if (terms.length === 0) return true;
      const relativePath = vscode.workspace.asRelativePath(file);
      const parts = relativePath.split("/");
      const fileName = parts.pop() || relativePath;
      const dirPath = parts.join("/");
      const searchableTarget = `${fileName} ${dirPath}`;
      return regex.test(searchableTarget);
     })
     .slice(0, 100);

    const items = filtered.map(file => {
     const relativePath = vscode.workspace.asRelativePath(file);
     const fileName = file.path.split("/").pop() || relativePath;
     return {
      label: `$(file) ${fileName}`,
      description: relativePath,
      alwaysShow: true,
      fileUri: file
     };
    });

    quickPick.items = items;
   }
  });

  quickPick.onDidAccept(async () => {
   const selection = quickPick.selectedItems[0];
   if (selection) {
    if (selection.fileUri) {
     const doc = await vscode.workspace.openTextDocument(selection.fileUri);
     await vscode.window.showTextDocument(doc);
    } else if (selection.symbolData) {
     const doc = await vscode.workspace.openTextDocument(selection.symbolData.location.uri);
     const editor = await vscode.window.showTextDocument(doc);
     const range = selection.symbolData.location.range;

     editor.selection = new vscode.Selection(range.start, range.end);
     editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
   }
   quickPick.hide();
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
 });

 context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
 activate,
 deactivate
};