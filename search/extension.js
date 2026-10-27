const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

const SYMBOL_KIND_MAP = {
	[vscode.SymbolKind.File]: { name: "File", icon: "symbol-file" },
	[vscode.SymbolKind.Module]: { name: "Module", icon: "symbol-module" },
	[vscode.SymbolKind.Namespace]: { name: "Namespace", icon: "symbol-namespace" },
	[vscode.SymbolKind.Package]: { name: "Package", icon: "symbol-package" },
	[vscode.SymbolKind.Class]: { name: "Class", icon: "symbol-class" },
	[vscode.SymbolKind.Method]: { name: "Method", icon: "symbol-method" },
	[vscode.SymbolKind.Property]: { name: "Property", icon: "symbol-property" },
	[vscode.SymbolKind.Field]: { name: "Field", icon: "symbol-field" },
	[vscode.SymbolKind.Constructor]: { name: "Constructor", icon: "symbol-constructor" },
	[vscode.SymbolKind.Enum]: { name: "Enum", icon: "symbol-enum" },
	[vscode.SymbolKind.Interface]: { name: "Interface", icon: "symbol-interface" },
	[vscode.SymbolKind.Function]: { name: "Function", icon: "symbol-function" },
	[vscode.SymbolKind.Variable]: { name: "Variable", icon: "symbol-variable" },
	[vscode.SymbolKind.Constant]: { name: "Constant", icon: "symbol-constant" },
	[vscode.SymbolKind.String]: { name: "String", icon: "symbol-string" },
	[vscode.SymbolKind.Number]: { name: "Number", icon: "symbol-number" },
	[vscode.SymbolKind.Boolean]: { name: "Boolean", icon: "symbol-boolean" },
	[vscode.SymbolKind.Array]: { name: "Array", icon: "symbol-array" },
	[vscode.SymbolKind.Object]: { name: "Object", icon: "symbol-object" },
	[vscode.SymbolKind.Key]: { name: "Key", icon: "symbol-key" },
	[vscode.SymbolKind.Null]: { name: "Null", icon: "symbol-null" },
	[vscode.SymbolKind.EnumMember]: { name: "EnumMember", icon: "symbol-enum-member" },
	[vscode.SymbolKind.Struct]: { name: "Struct", icon: "symbol-struct" },
	[vscode.SymbolKind.Event]: { name: "Event", icon: "symbol-event" },
	[vscode.SymbolKind.Operator]: { name: "Operator", icon: "symbol-operator" },
	[vscode.SymbolKind.TypeParameter]: { name: "TypeParameter", icon: "symbol-parameter" }
};

function getSymbolInfo(kind)
{
	return SYMBOL_KIND_MAP[kind] || { name: "Symbol", icon: "symbol-misc" };
}

function getRipgrepPath()
{
	const exe = process.platform === "win32" ? "rg.exe" : "rg";
	const possiblePaths = [
		path.join(vscode.env.appRoot, "node_modules", "@vscode", "ripgrep", "bin", exe),
		path.join(vscode.env.appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", exe),
		path.join(vscode.env.appRoot, "node_modules", "vscode-ripgrep", "bin", exe),
		path.join(vscode.env.appRoot, "node_modules.asar.unpacked", "vscode-ripgrep", "bin", exe)
	];
	for(const p of possiblePaths)
	{
		if(fs.existsSync(p)) return p;
	}
	return "rg";
}

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
	const rgPath = getRipgrepPath();

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
		quickPick.placeholder = "Type to search files and symbols, ? for text, or > for commands...";
		
		const config = vscode.workspace.getConfiguration("customSearch");
		const rawHigh = config.get("highPriorityExtensions", []);
		const rawLow = config.get("lowPriorityExtensions", []);
		const excludePatterns = config.get("excludePatterns", []);
		
		const highPriorityExts = new Set(rawHigh.map(e => e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`));
		const lowPriorityExts = new Set(rawLow.map(e => e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`));

		let rgTimeout = null;
		let currentRgProcess = null;

		quickPick.onDidChangeValue(async (value) =>
		{
			if(rgTimeout) clearTimeout(rgTimeout);
			if(currentRgProcess)
			{
				currentRgProcess.kill();
				currentRgProcess = null;
			}

			if(value.startsWith(">"))
			{
				quickPick.hide();
				vscode.commands.executeCommand("workbench.action.showCommands");
				return;
			}

			// --- ? Text Search Mode ---
			if(value.startsWith("?"))
			{
				const searchQuery = value.slice(1).trim();
				const folders = vscode.workspace.workspaceFolders;

				if(!folders || searchQuery.length === 0)
				{
					quickPick.items = [];
					quickPick.busy = false;
					return;
				}

				const rootPath = folders[0].uri.fsPath;
				quickPick.busy = true;

				rgTimeout = setTimeout(() =>
				{
					// --fixed-strings (-F) prevents regex crashes on special chars like ( ) [ ] ?
					const args = [
						"--vimgrep",
						"--fixed-strings",
						"--smart-case",
						"--max-count", "50",
						"--max-columns", "300"
					];

					for(const pattern of excludePatterns)
					{
						args.push("-g", `!${pattern}`);
					}
					args.push("--", searchQuery, ".");

					const proc = cp.spawn(rgPath, args, { cwd: rootPath });
					currentRgProcess = proc;

					let stdout = "";
					let killedEarly = false;

					proc.stdout.on("data", data =>
					{
						stdout += data.toString();
						if(!killedEarly && stdout.split("\n").length > 100)
						{
							killedEarly = true;
							proc.kill();
						}
					});

					proc.on("close", () =>
					{
						// Ignore if this process was superseded by a newer keystroke
						if(currentRgProcess !== proc) return;
						quickPick.busy = false;

						const lines = stdout.split(/\r?\n/).filter(Boolean).slice(0, 100);
						const textItems = lines.map(line =>
						{
							const match = line.match(/^(.*?):(\d+):(\d+):(.*)$/);
							if(!match) return null;

							const [, file, lineStr, colStr, text] = match;
							const lineNum = parseInt(lineStr, 10) - 1;
							const colNum = parseInt(colStr, 10) - 1;
							const normalizedFile = file.replace(/^\.[\\/]/, "").replace(/\\/g, "/");

							return {
								label: `$(search) [Text] ${text.trim()}`,
								description: `${normalizedFile}:${lineStr}`,
								alwaysShow: true,
								textMatchData: {
									uri: vscode.Uri.file(path.join(rootPath, file)),
									line: lineNum,
									col: colNum,
									len: searchQuery.length
								}
							};
						}).filter(Boolean);

						if(textItems.length > 0)
						{
							quickPick.items = [
								{ label: "Text Matches", kind: vscode.QuickPickItemKind.Separator },
								...textItems
							];
						}
						else
						{
							quickPick.items = [];
						}
					});

					proc.on("error", err =>
					{
						console.error("[CustomSearch] Ripgrep error:", err);
						quickPick.busy = false;
					});
				}, 120);

				return;
			}
			// --- END: ? Text Search Mode ---

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
				label: `$(file) [File] ${file.fileName}`,
				description: file.relativePath,
				alwaysShow: true,
				fileUri: file.uri
			}));

			if(fileItems.length > 0)
			{
				quickPick.items = [
					{ label: "Files", kind: vscode.QuickPickItemKind.Separator },
					...fileItems
				];
			}
			else
			{
				quickPick.items = [];
			}

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

						const symbolItems = filteredSymbols.map(item =>
						{
							const symInfo = getSymbolInfo(item.sym.kind);
							return {
								label: `$(${symInfo.icon}) [${symInfo.name}] ${item.sym.name}`,
								description: item.relativePath,
								detail: item.sym.containerName,
								alwaysShow: true,
								symbolData: item.sym
							};
						});

						if(quickPick.value === value)
						{
							const combined = [];
							if(fileItems.length > 0)
							{
								combined.push({ label: "Files", kind: vscode.QuickPickItemKind.Separator });
								combined.push(...fileItems);
							}
							if(symbolItems.length > 0)
							{
								combined.push({ label: "Symbols", kind: vscode.QuickPickItemKind.Separator });
								combined.push(...symbolItems);
							}
							quickPick.items = combined;
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
				} else if(selection.textMatchData)
				{
					const { uri, line, col, len } = selection.textMatchData;
					const doc = await vscode.workspace.openTextDocument(uri);
					const editor = await vscode.window.showTextDocument(doc);

					const startPos = new vscode.Position(line, col);
					const endPos = new vscode.Position(line, col + len);
					const range = new vscode.Range(startPos, endPos);

					editor.selection = new vscode.Selection(startPos, endPos);
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				}
			}
			quickPick.hide();
		});

		quickPick.onDidHide(() =>
		{
			if(rgTimeout) clearTimeout(rgTimeout);
			if(currentRgProcess) currentRgProcess.kill();
			quickPick.dispose();
		});
		quickPick.show();
	});

	context.subscriptions.push(disposable);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};