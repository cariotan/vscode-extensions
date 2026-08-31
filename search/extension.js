const vscode = require("vscode");

function getVersionNumber(filePath) {
	const matches = filePath.match(/v(\d+)/gi);
	if (!matches) return 0;
	const numbers = matches.map(m => parseInt(m.slice(1), 10));
	return Math.max(...numbers);
}

let count = 0;
function getExtensionPriorityScore(uri, highPriorityExts, lowPriorityExts) {
	console.log(count++);
	const path = uri.path.toLowerCase();

	// Check high priority list
	const isHighPriority = highPriorityExts.some(ext => {
		const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
		return path.endsWith(normalized);
	});
	if (isHighPriority) return 1;

	// Check low priority list
	const isLowPriority = lowPriorityExts.some(ext => {
		const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
		return path.endsWith(normalized);
	});
	if (isLowPriority) return -1;

	// Normal priority
	return 0;
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
		quickPick.placeholder = "Type to search files and symbols, or > for commands...";

		// Read current setting configuration
		const config = vscode.workspace.getConfiguration("customSearch");
		const highPriorityExts = config.get("highPriorityExtensions", []);
		const lowPriorityExts = config.get("lowPriorityExtensions", []);

		quickPick.onDidChangeValue(async (value) => {
			console.log(`[CustomSearch] Input changed: "${value}"`);

			if (value.startsWith(">")) {
				quickPick.hide();
				vscode.commands.executeCommand("workbench.action.showCommands");
				return;
			}

			const terms = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
			const regex = new RegExp(pattern, "i");

			// 1. Process and display files immediately
			const filteredFiles = cachedFiles
				.filter(file => {
					if (terms.length === 0) return true;
					const relativePath = vscode.workspace.asRelativePath(file);
					const parts = relativePath.split("/");
					const fileName = parts.pop() || relativePath;
					const dirPath = parts.join("/");
					const searchableTarget = `${fileName} ${dirPath} ${fileName}`;
					return regex.test(searchableTarget);
				})
				.sort((a, b) => {
					const priorityA = getExtensionPriorityScore(a, highPriorityExts, lowPriorityExts);
					const priorityB = getExtensionPriorityScore(b, highPriorityExts, lowPriorityExts);

					if (priorityA !== priorityB) {
						return priorityB - priorityA;
					}

					const relA = vscode.workspace.asRelativePath(a);
					const relB = vscode.workspace.asRelativePath(b);
					return getVersionNumber(relB) - getVersionNumber(relA);
				})
				.slice(0, 100);

			const fileItems = filteredFiles.map(file => {
				const relativePath = vscode.workspace.asRelativePath(file);
				const fileName = file.path.split("/").pop() || relativePath;
				return {
					label: `$(file) ${fileName}`,
					description: relativePath,
					alwaysShow: true,
					fileUri: file
				};
			});

			quickPick.items = fileItems;

			// 2. Fetch and append symbols if there's a search term
			if (terms.length > 0) {
				quickPick.busy = true;
				try {
					const providerQuery = terms[0] || "";
					const symbols = await vscode.commands.executeCommand(
						"vscode.executeWorkspaceSymbolProvider",
						providerQuery
					);

					if (symbols && symbols.length > 0) {
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

						const symbolItems = filteredSymbols.map(sym => ({
							label: `$(symbol-misc) ${sym.name}`,
							description: vscode.workspace.asRelativePath(sym.location.uri),
							detail: sym.containerName,
							alwaysShow: true,
							symbolData: sym
						}));

						// Prevent older requests from overwriting newer keystrokes
						if (quickPick.value === value) {
							quickPick.items = [...fileItems, ...symbolItems];
						}
					}
				} catch (err) {
					console.error("[CustomSearch] Symbol search error:", err);
				} finally {
					if (quickPick.value === value) {
						quickPick.busy = false;
					}
				}
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