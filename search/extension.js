const vscode = require("vscode");

function getVersionNumber(filePath)
{
	const matches = filePath.match(/v(\d+)/gi);
	if(!matches) return 0;
	const numbers = matches.map(m => parseInt(m.slice(1), 10));
	return Math.max(...numbers);
}

function processUri(uri)
{
	const relativePath = vscode.workspace.asRelativePath(uri);
	const parts = relativePath.split("/");
	const fileName = parts.pop() || relativePath;
	const dirPath = parts.join("/");
	
	const pathLower = uri.path.toLowerCase();
	const lastDot = pathLower.lastIndexOf(".");
	const ext = lastDot !== -1 ? pathLower.substring(lastDot) : "";

	return {
		uri,
		relativePath,
		fileName,
		searchableTarget: `${fileName} ${dirPath} ${fileName}`,
		version: getVersionNumber(relativePath),
		ext
	};
}

function activate(context)
{
	let cachedFilesData = [];

	function refreshFiles()
	{
		const config = vscode.workspace.getConfiguration("customSearch");
		const excludePatterns = config.get("excludePatterns", []);
		
		// Wrap the array in {} to create a valid VS Code glob pattern
		const excludeGlob = excludePatterns.length > 0 ? `{${excludePatterns.join(',')}}` : null;

		vscode.workspace.findFiles("**/*", excludeGlob).then(files =>
		{
			cachedFilesData = files.map(processUri);
		});
	}

	refreshFiles();

	const watcher = vscode.workspace.createFileSystemWatcher("**/*");
	watcher.onDidCreate(uri =>
	{
		const relativePath = vscode.workspace.asRelativePath(uri);
		
		// Quick check to stop standard build output from caching
		if(relativePath.includes("/bin/") || relativePath.includes("/obj/") || relativePath.includes("node_modules")) {
			return;
		}

		if(!cachedFilesData.some(f => f.uri.toString() === uri.toString()))
		{
			cachedFilesData.push(processUri(uri));
		}
	});
	watcher.onDidDelete(uri =>
	{
		cachedFilesData = cachedFilesData.filter(f => f.uri.toString() !== uri.toString());
	});

	context.subscriptions.push(watcher);

	let disposable = vscode.commands.registerCommand("customSearch.start", () =>
	{
		const quickPick = vscode.window.createQuickPick();
		quickPick.placeholder = "Type to search files and symbols, or > for commands...";

		const config = vscode.workspace.getConfiguration("customSearch");
		const rawHigh = config.get("highPriorityExtensions", []);
		const rawLow = config.get("lowPriorityExtensions", []);
		
		const highPriorityExts = new Set(rawHigh.map(e => e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`));
		const lowPriorityExts = new Set(rawLow.map(e => e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`));

		quickPick.onDidChangeValue(async (value) =>
		{
			if(value.startsWith(">"))
			{
				quickPick.hide();
				vscode.commands.executeCommand("workbench.action.showCommands");
				return;
			}

			const terms = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const rawQueryWithoutSpaces = value.trim().toLowerCase().replace(/\s+/g, "");
			const sequence = value.trim().replace(/\s+/g, "");
			
			// Use .*? for non-greedy matching to calculate match spread accurately
			const pattern = sequence.split("").map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*?");
			const regex = new RegExp(pattern, "i");

			// 1. Process files with exact match and spread scoring
			const filteredFiles = cachedFilesData
				.map(file =>
				{
					if(terms.length === 0) return { ...file, matched: true, exactScore: 0, spread: 0 };
					
					const match = regex.exec(file.searchableTarget);
					if(!match) return { ...file, matched: false };
					
					let exactScore = 0;
					const lowerName = file.fileName.toLowerCase();
					
					if(lowerName.includes(rawQueryWithoutSpaces)) exactScore = 2; // Direct filename chunk
					else if(file.relativePath.toLowerCase().includes(rawQueryWithoutSpaces)) exactScore = 1; // Path chunk
					
					return { ...file, matched: true, exactScore, spread: match[0].length };
				})
				.filter(f => f.matched)
				.sort((a, b) =>
				{
					if(a.exactScore !== b.exactScore) return b.exactScore - a.exactScore;
					if(a.spread !== b.spread) return a.spread - b.spread;
					
					const priorityA = highPriorityExts.has(a.ext) ? 1 : (lowPriorityExts.has(a.ext) ? -1 : 0);
					const priorityB = highPriorityExts.has(b.ext) ? 1 : (lowPriorityExts.has(b.ext) ? -1 : 0);

					if(priorityA !== priorityB) return priorityB - priorityA;
					return b.version - a.version;
				})
				.slice(0, 100);

			const fileItems = filteredFiles.map(file => ({
				label: `$(file) ${file.fileName}`,
				description: file.relativePath,
				alwaysShow: true,
				fileUri: file.uri
			}));

			quickPick.items = fileItems;

			// 2. Fetch and apply the same scoring logic to symbols
			if(terms.length > 0)
			{
				quickPick.busy = true;
				try
				{
					const providerQuery = terms[0] || "";
					const symbols = await vscode.commands.executeCommand(
						"vscode.executeWorkspaceSymbolProvider",
						providerQuery
					);

					if(symbols && symbols.length > 0)
					{
						const filteredSymbols = symbols
							.map(sym =>
							{
								const relativePath = vscode.workspace.asRelativePath(sym.location.uri);
								const searchableTarget = `${sym.name} ${sym.containerName || ""} ${relativePath}`;
								const match = regex.exec(searchableTarget);
								if(!match) return { sym, matched: false };

								let exactScore = 0;
								const lowerName = sym.name.toLowerCase();
								
								if(lowerName.includes(rawQueryWithoutSpaces)) exactScore = 2;
								else if(searchableTarget.toLowerCase().includes(rawQueryWithoutSpaces)) exactScore = 1;

								return { 
									sym, 
									relativePath,
									exactScore,
									spread: match[0].length,
									matched: true
								};
							})
							.filter(item => item.matched)
							.sort((a, b) =>
							{
								if(a.exactScore !== b.exactScore) return b.exactScore - a.exactScore;
								if(a.spread !== b.spread) return a.spread - b.spread;
								
								return getVersionNumber(b.relativePath) - getVersionNumber(a.relativePath);
							})
							.slice(0, 100);

						const symbolItems = filteredSymbols.map(item => ({
							label: `$(symbol-misc) ${item.sym.name}`,
							description: item.relativePath,
							detail: item.sym.containerName,
							alwaysShow: true,
							symbolData: item.sym
						}));

						if(quickPick.value === value)
						{
							quickPick.items = [...fileItems, ...symbolItems];
						}
					}
				} catch(err)
				{
					console.error("[CustomSearch] Symbol search error:", err);
				} finally
				{
					if(quickPick.value === value)
					{
						quickPick.busy = false;
					}
				}
			}
		});

		quickPick.onDidAccept(async () =>
		{
			const selection = quickPick.selectedItems[0];
			if(selection)
			{
				if(selection.fileUri)
				{
					const doc = await vscode.workspace.openTextDocument(selection.fileUri);
					await vscode.window.showTextDocument(doc);
				} else if(selection.symbolData)
				{
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

function deactivate() { }

module.exports = {
	activate,
	deactivate
};