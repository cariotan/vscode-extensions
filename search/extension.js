const vscode = require("vscode");

function getVersionNumber(filePath) {
 const matches = filePath.match(/v(\d+)/gi);
 if (!matches) return 0;
 const numbers = matches.map(m => parseInt(m.slice(1), 10));
 return Math.max(...numbers);
}

function activate(context) {
 let cachedFiles = [];

 function refreshFiles() {
  vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**}").then(files => {
   console.log(`[CustomSearch] Cached ${files.length} workspace files.`);
   cachedFiles = files;
  });
 }

 refreshFiles();

 const watcher = vscode.workspace.createFileSystemWatcher("**/*");
 watcher.onDidCreate(uri => {
  if (!cachedFiles.some(f => f.toString() === uri.toString())) {
   cachedFiles.push(uri);
  }
 });
 watcher.onDidDelete(uri => {
  cachedFiles = cachedFiles.filter(f => f.toString() !== uri.toString());
 });

 context.subscriptions.push(watcher);

 let disposable = vscode.commands.registerCommand("customSearch.start", () => {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = "Type to search files, # for symbols, or > for commands...";

  quickPick.onDidChangeValue(async (value) => {
   console.log(`[CustomSearch] Input changed: "${value}"`);

   if (value.startsWith(">")) {
    quickPick.hide();
    vscode.commands.executeCommand("workbench.action.showCommands");
    return;
   }

   const hasSymbolTrigger = value.includes("#");
   const cleanQuery = value.replaceAll("#", " ");

   if (hasSymbolTrigger) {
    quickPick.busy = true;
    try {
     const terms = cleanQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
     const providerQuery = terms[0] || "";
     console.log(`[CustomSearch] Triggering workspace symbol search for: "${providerQuery}"`);

     const symbols = await vscode.commands.executeCommand(
      "vscode.executeWorkspaceSymbolProvider",
      providerQuery
     );

     if (symbols && symbols.length > 0) {
      const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      const regex = new RegExp(pattern, "i");

      const filteredSymbols = symbols
       .filter(sym => {
        const relativePath = vscode.workspace.asRelativePath(sym.location.uri);
        const searchableTarget = `${sym.name} ${sym.containerName || ""} ${relativePath}`;
        return regex.test(searchableTarget);
       })
       .sort((a, b) => {
        const relA = vscode.workspace.asRelativePath(a.location.uri);
        const relB = vscode.workspace.asRelativePath(b.location.uri);
        return getVersionNumber(relB) - getVersionNumber(relA);
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
     .sort((a, b) => {
      const relA = vscode.workspace.asRelativePath(a);
      const relB = vscode.workspace.asRelativePath(b);
      return getVersionNumber(relB) - getVersionNumber(relA);
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