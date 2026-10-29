const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
	* Helper to get the target file path for Default.code-profile
	*/
function getProfileFilePath()
{
	const config = vscode.workspace.getConfiguration('quickProfile');
	let dir = config.get('exportDirectory');

	if(!dir || dir.trim() === '')
	{
		dir = path.join(os.homedir(), 'Desktop');
	}
	return {
		dir: dir,
		filePath: path.join(dir, 'Default.code-profile')
	};
}

/**
	* @param {vscode.ExtensionContext} context
	*/
function activate(context)
{

	// =========================================================================
	// 1. EXPORT COMMAND
	// =========================================================================
	let exportCommand = vscode.commands.registerCommand('quickProfile.exportDefault', async () =>
	{
		try
		{
			const { dir, filePath } = getProfileFilePath();
			const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));

			const profileData = {
				name: "Default"
			};

			// Grab Settings (settings.json)
			const settingsPath = path.join(userDir, 'settings.json');
			if(fs.existsSync(settingsPath))
			{
				const rawSettings = fs.readFileSync(settingsPath, 'utf8');
				profileData.settings = JSON.stringify({ settings: rawSettings });
			}

			// Grab Keybindings (keybindings.json)
			const keybindingsPath = path.join(userDir, 'keybindings.json');
			if(fs.existsSync(keybindingsPath))
			{
				const rawKeybindings = fs.readFileSync(keybindingsPath, 'utf8');
				const platformMap = { 'win32': 3, 'darwin': 2, 'linux': 1 };
				profileData.keybindings = JSON.stringify({
					keybindings: rawKeybindings,
					platform: platformMap[process.platform] || 3
				});
			}

			// Grab Snippets (User/snippets/*)
			const snippetsDir = path.join(userDir, 'snippets');
			if(fs.existsSync(snippetsDir))
			{
				const snippetsObj = {};
				const files = fs.readdirSync(snippetsDir);
				for(const file of files)
				{
					if(file.endsWith('.json') || file.endsWith('.code-snippets'))
					{
						snippetsObj[file] = fs.readFileSync(path.join(snippetsDir, file), 'utf8');
					}
				}
				if(Object.keys(snippetsObj).length > 0)
				{
					profileData.snippets = JSON.stringify({ snippets: snippetsObj });
				}
			}

			// Grab Tasks (tasks.json)
			const tasksPath = path.join(userDir, 'tasks.json');
			if(fs.existsSync(tasksPath))
			{
				const rawTasks = fs.readFileSync(tasksPath, 'utf8');
				profileData.tasks = JSON.stringify({ tasks: rawTasks });
			}

			// Grab Installed Extensions (Still exported so the file is valid, just ignored on import)
			const extensions = vscode.extensions.all
				.filter(ext => !ext.packageJSON.isBuiltin)
				.filter(ext => ext.id !== context.extension.id)
				.map(ext => ({
					identifier: { id: ext.id },
					displayName: ext.packageJSON.displayName || ext.id
				}));

			profileData.extensions = JSON.stringify(extensions);

			// --- CUSTOM EXPORT LOGIC HERE ---

			if(!fs.existsSync(dir))
			{
				fs.mkdirSync(dir, { recursive: true });
			}

			fs.writeFileSync(filePath, JSON.stringify(profileData), 'utf8');
			vscode.window.showInformationMessage(`Exported Default profile to: ${filePath}`);

		} catch(error)
		{
			vscode.window.showErrorMessage(`Profile Export Failed: ${error.message}`);
		}
	});

	// =========================================================================
	// 2. IMPORT COMMAND (IGNORES EXTENSIONS)
	// =========================================================================
	let importCommand = vscode.commands.registerCommand('quickProfile.importDefault', async () =>
	{
		try
		{
			const { filePath } = getProfileFilePath();

			if(!fs.existsSync(filePath))
			{
				vscode.window.showErrorMessage(`Profile file not found at: ${filePath}`);
				return;
			}

			const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
			const rawFile = fs.readFileSync(filePath, 'utf8');
			const profileData = JSON.parse(rawFile);

			// --- CUSTOM IMPORT LOGIC HERE (before files are written) ---

			// 1. Restore Settings (settings.json)
			if(profileData.settings)
			{
				const parsedSettings = JSON.parse(profileData.settings);
				if(parsedSettings.settings)
				{
					const settingsPath = path.join(userDir, 'settings.json');

					// NOTE: If you ever import onto a brand new machine before setting "quickProfile.exportDirectory",
					// overwriting settings.json is totally fine because it will overwrite it with the exported setting!
					fs.writeFileSync(settingsPath, parsedSettings.settings, 'utf8');
				}
			}

			// 2. Restore Keybindings (keybindings.json)
			if(profileData.keybindings)
			{
				const parsedKeybindings = JSON.parse(profileData.keybindings);
				if(parsedKeybindings.keybindings)
				{
					const keybindingsPath = path.join(userDir, 'keybindings.json');
					fs.writeFileSync(keybindingsPath, parsedKeybindings.keybindings, 'utf8');
				}
			}

			// 3. Restore Snippets (User/snippets/*)
			if(profileData.snippets)
			{
				const parsedSnippets = JSON.parse(profileData.snippets);
				if(parsedSnippets.snippets)
				{
					const snippetsDir = path.join(userDir, 'snippets');
					if(!fs.existsSync(snippetsDir))
					{
						fs.mkdirSync(snippetsDir, { recursive: true });
					}
					for(const [fileName, content] of Object.entries(parsedSnippets.snippets))
					{
						const snippetFilePath = path.join(snippetsDir, fileName);
						fs.writeFileSync(snippetFilePath, content, 'utf8');
					}
				}
			}

			// 4. Restore Tasks (tasks.json)
			if(profileData.tasks)
			{
				const parsedTasks = JSON.parse(profileData.tasks);
				if(parsedTasks.tasks)
				{
					const tasksPath = path.join(userDir, 'tasks.json');
					fs.writeFileSync(tasksPath, parsedTasks.tasks, 'utf8');
				}
			}

			// 5. Extensions (`profileData.extensions`) are completely ignored!

			vscode.window.showInformationMessage(`Imported Default profile (without extensions) from: ${filePath}`);

		} catch(error)
		{
			vscode.window.showErrorMessage(`Profile Import Failed: ${error.message}`);
		}
	});

	context.subscriptions.push(exportCommand, importCommand);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};