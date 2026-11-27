'use strict';

const vscode = require('vscode');
const path = require('path');
const {
	extractListeningUrlsFromOutput,
	extractProjectHintFromWatchOutput,
	extractHintsFromArgs,
	isDotnetWatchCommand,
	pickPreferredUrl,
	isCSharpDebugType
} = require('./lib/urlParser');
const { resolveProjectDir, readLaunchConfigUrls } = require('./lib/projectDiscovery');
const { findDotnetWatchProcesses } = require('./lib/processWatcher');
const { SessionManager } = require('./lib/sessionManager');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context)
{
	const output = vscode.window.createOutputChannel('.NET Application URL');
	const sessionManager = new SessionManager();
	let statusBarItem = createStatusBarItem();
	let pollTimer = null;
	let isPolling = false;
	let shellExecCounter = 0;

	/** @type {WeakMap<object, string>} */
	const shellExecutionIds = new WeakMap();

	function getConfig()
	{
		return vscode.workspace.getConfiguration('dotnetAppUrl');
	}

	function createStatusBarItem()
	{
		const cfg = getConfig();
		const alignmentStr = cfg.get('statusBarAlignment', 'left');
		const alignment = alignmentStr === 'right'
			? vscode.StatusBarAlignment.Right
			: vscode.StatusBarAlignment.Left;
		const priority = Number(cfg.get('statusBarPriority', 100)) || 100;

		const item = vscode.window.createStatusBarItem(alignment, priority);
		item.command = 'dotnetAppUrl.open';
		return item;
	}

	function getWorkspaceFolderPaths()
	{
		return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
	}

	function log(msg)
	{
		output.appendLine(`[${new Date().toISOString()}] ${msg}`);
	}

	function updateStatusBar()
	{
		const sessions = sessionManager.getSessionsWithUrls();
		const preferHttps = Boolean(getConfig().get('preferHttps', true));

		if(sessions.length === 0)
		{
			statusBarItem.hide();
			return;
		}

		if(sessions.length === 1)
		{
			const s = sessions[0];
			const primaryUrl = pickPreferredUrl(s.urls, preferHttps);
			if(!primaryUrl)
			{
				statusBarItem.hide();
				return;
			}

			statusBarItem.text = `$(globe) ${primaryUrl}`;
			const md = new vscode.MarkdownString('', true);
			md.appendMarkdown(`**${s.label}** (${s.kind === 'debug' ? 'C# Debug' : 'dotnet watch'})\n\n`);
			for(const u of s.urls)
			{
				md.appendMarkdown(`- ${u}\n`);
			}
			md.appendMarkdown(`\n*Click to open ${primaryUrl} in browser*`);
			statusBarItem.tooltip = md;
			statusBarItem.command = 'dotnetAppUrl.open';
			statusBarItem.show();
			return;
		}

		const firstUrl = pickPreferredUrl(sessions[0].urls, preferHttps);
		statusBarItem.text = `$(globe) ${sessions.length} .NET Apps`;
		const md = new vscode.MarkdownString('', true);
		md.appendMarkdown('**Active .NET Applications**\n\n');
		for(const s of sessions)
		{
			const u = pickPreferredUrl(s.urls, preferHttps);
			md.appendMarkdown(`- **${s.label}** (${s.kind === 'debug' ? 'Debug' : 'watch'}): ${u}\n`);
		}
		if(firstUrl)
		{
			md.appendMarkdown('\n*Click to choose an application URL to open*');
		}
		statusBarItem.tooltip = md;
		statusBarItem.command = 'dotnetAppUrl.open';
		statusBarItem.show();
	}

	async function openUrl(url)
	{
		if(!url)
		{
			return;
		}
		log(`Opening URL in browser: ${url}`);
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}

	async function pickAndOpenUrl(sessions)
	{
		const preferHttps = Boolean(getConfig().get('preferHttps', true));
		const items = [];

		for(const s of sessions)
		{
			const ordered = [...s.urls].sort((a, b) =>
			{
				const aPref = a === pickPreferredUrl(s.urls, preferHttps) ? -1 : 0;
				const bPref = b === pickPreferredUrl(s.urls, preferHttps) ? -1 : 0;
				return aPref - bPref;
			});
			for(const url of ordered)
			{
				items.push({
					label: `$(globe) ${url}`,
					description: s.label,
					detail: `${s.kind === 'debug' ? 'C# Debug' : 'dotnet watch'}${s.urlSource ? ` • ${s.urlSource}` : ''}`,
					url
				});
			}
		}

		if(items.length === 0)
		{
			vscode.window.showInformationMessage('No active .NET application URLs detected.');
			return;
		}

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a .NET application URL to open in the browser'
		});
		if(picked)
		{
			await openUrl(picked.url);
		}
	}

	function registerDebugSession(session)
	{
		if(!session || !isCSharpDebugType(session.type))
		{
			return;
		}

		const cfg = session.configuration || {};
		const argsHints = extractHintsFromArgs(cfg.args || []);
		const envUrls = (cfg.env && (cfg.env.ASPNETCORE_URLS || cfg.env.DOTNET_URLS)) || null;
		const workspaceFolders = getWorkspaceFolderPaths();

		const projectDir = resolveProjectDir({
			cwd: cfg.cwd || (session.workspaceFolder && session.workspaceFolder.uri.fsPath),
			program: cfg.program,
			projectHint: cfg.projectPath || argsHints.projectHint,
			launchSettingsFilePath: cfg.launchSettingsFilePath,
			workspaceFolders
		});

		const configResult = readLaunchConfigUrls(projectDir, {
			profileName: cfg.launchSettingsProfile || argsHints.profileName,
			envUrls,
			launchSettingsFilePath: cfg.launchSettingsFilePath,
			cliUrls: argsHints.urls
		});

		const label = configResult.projectName || session.name || 'C# Debug';
		const id = `debug:${session.id}`;
		log(`Debug session started: ${label} (${id}), projectDir=${projectDir || 'unknown'}, configUrls=${JSON.stringify(configResult.urls)}`);

		sessionManager.upsertSession(id, {
			kind: 'debug',
			source: 'debug',
			label,
			projectDir,
			configUrls: configResult.urls,
			urlSource: configResult.source
		});
	}

	function createDebugAdapterTracker(session)
	{
		if(!isCSharpDebugType(session.type))
		{
			return undefined;
		}

		const id = `debug:${session.id}`;
		let lineBuffer = '';

		return {
			onDidSendMessage(message)
			{
				if(!message || message.type !== 'event' || message.event !== 'output')
				{
					return;
				}
				const text = message.body && message.body.output;
				if(typeof text !== 'string' || !text)
				{
					return;
				}

				lineBuffer += text;
				const urls = extractListeningUrlsFromOutput(lineBuffer);
				if(urls.length > 0)
				{
					log(`Debug runtime URLs detected (${id}): ${JSON.stringify(urls)}`);
					sessionManager.addRuntimeUrls(id, urls, false);
				}

				if(lineBuffer.length > 8192)
				{
					lineBuffer = lineBuffer.slice(-2048);
				}
			}
		};
	}

	async function handleShellExecutionStart(event)
	{
		const execution = event && event.execution;
		const terminal = event && event.terminal;
		const commandLine = execution && execution.commandLine && execution.commandLine.value;
		if(!commandLine || !isDotnetWatchCommand(commandLine))
		{
			return;
		}

		const id = `shell:${++shellExecCounter}`;
		shellExecutionIds.set(execution, id);

		const hints = extractHintsFromArgs(commandLine);
		const cwd = (execution.cwd && execution.cwd.fsPath)
			|| (terminal && terminal.shellIntegration && terminal.shellIntegration.cwd && terminal.shellIntegration.cwd.fsPath)
			|| getWorkspaceFolderPaths()[0]
			|| null;

		const projectDir = resolveProjectDir({
			cwd,
			projectHint: hints.projectHint,
			workspaceFolders: getWorkspaceFolderPaths()
		});

		const configResult = readLaunchConfigUrls(projectDir, {
			profileName: hints.profileName,
			cliUrls: hints.urls
		});

		const pid = terminal && typeof terminal.processId === 'object'
			? await terminal.processId.catch(() => null)
			: null;

		const label = configResult.projectName || (terminal && terminal.name) || 'dotnet watch';
		log(`Shell dotnet watch started: ${label} (${id}), cmd="${commandLine}", projectDir=${projectDir || 'unknown'}, configUrls=${JSON.stringify(configResult.urls)}`);

		sessionManager.upsertSession(id, {
			kind: 'watch',
			source: 'shell',
			label,
			projectDir,
			pid,
			configUrls: configResult.urls,
			urlSource: configResult.source
		});

		if(typeof execution.read === 'function')
		{
			(async () =>
			{
				let buffer = '';
				let sawHotReloadRestart = false;
				let resolvedDir = projectDir;
				try
				{
					for await (const chunk of execution.read())
					{
						if(typeof chunk !== 'string' || !chunk)
						{
							continue;
						}
						buffer += chunk;

						if(!resolvedDir)
						{
							const outputHint = extractProjectHintFromWatchOutput(buffer);
							if(outputHint)
							{
								const foundDir = resolveProjectDir({
									cwd,
									projectHint: outputHint,
									program: outputHint,
									workspaceFolders: getWorkspaceFolderPaths()
								});
								if(foundDir)
								{
									resolvedDir = foundDir;
									const discovered = readLaunchConfigUrls(resolvedDir, {
										profileName: hints.profileName,
										cliUrls: hints.urls
									});
									log(`Shell watch resolved projectDir from output (${id}): ${resolvedDir}`);
									sessionManager.upsertSession(id, {
										kind: 'watch',
										source: 'shell',
										label: discovered.projectName || label,
										projectDir: resolvedDir,
										configUrls: discovered.urls,
										urlSource: discovered.source
									});
								}
							}
						}

						if(/dotnet watch\s+.*(?:Started|Hot reload|Restarting)/i.test(chunk))
						{
							sawHotReloadRestart = true;
						}

						const urls = extractListeningUrlsFromOutput(buffer);
						if(urls.length > 0)
						{
							log(`Shell runtime URLs detected (${id}): ${JSON.stringify(urls)}`);
							sessionManager.addRuntimeUrls(id, urls, sawHotReloadRestart);
							sawHotReloadRestart = false;
							buffer = '';
						}
						else if(buffer.length > 8192)
						{
							buffer = buffer.slice(-2048);
						}
					}
				}
				catch (err)
				{
					log(`Shell stream error (${id}): ${err && err.message ? err.message : err}`);
				}
			})();
		}
	}

	function handleShellExecutionEnd(event)
	{
		const execution = event && event.execution;
		if(!execution)
		{
			return;
		}
		const id = shellExecutionIds.get(execution);
		if(id)
		{
			shellExecutionIds.delete(execution);
			log(`Shell dotnet watch ended (${id})`);
			sessionManager.removeSession(id);
		}
	}

	function handleTaskStart(event)
	{
		const execution = event && event.execution;
		const task = execution && execution.task;
		const execDef = task && task.execution;
		if(!execDef)
		{
			return;
		}

		let cmdLine = '';
		let cwd = null;
		if(typeof execDef.command === 'string')
		{
			const args = Array.isArray(execDef.args) ? execDef.args.join(' ') : '';
			cmdLine = `${execDef.command} ${args}`.trim();
			cwd = execDef.options && execDef.options.cwd;
		}
		else if(typeof execDef.commandLine === 'string')
		{
			cmdLine = execDef.commandLine;
			cwd = execDef.options && execDef.options.cwd;
		}

		if(!cmdLine || !isDotnetWatchCommand(cmdLine))
		{
			return;
		}

		const workspaceFolders = getWorkspaceFolderPaths();
		const hints = extractHintsFromArgs(cmdLine);
		const projectDir = resolveProjectDir({
			cwd: cwd || (task.scope && task.scope.uri && task.scope.uri.fsPath) || workspaceFolders[0],
			projectHint: hints.projectHint,
			workspaceFolders
		});

		const configResult = readLaunchConfigUrls(projectDir, {
			profileName: hints.profileName,
			cliUrls: hints.urls
		});

		const id = `task:${event.processId || task.name}`;
		log(`Task dotnet watch started: ${task.name} (${id}), configUrls=${JSON.stringify(configResult.urls)}`);
		sessionManager.upsertSession(id, {
			kind: 'watch',
			source: 'task',
			label: configResult.projectName || task.name || 'dotnet watch',
			projectDir,
			pid: event.processId || null,
			configUrls: configResult.urls,
			urlSource: configResult.source
		});
	}

	function handleTaskEnd(event)
	{
		const task = event && event.execution && event.execution.task;
		const idByPid = event && event.processId ? `task:${event.processId}` : null;
		const idByName = task ? `task:${task.name}` : null;
		if(idByPid)
		{
			sessionManager.removeSession(idByPid);
		}
		if(idByName)
		{
			sessionManager.removeSession(idByName);
		}
	}

	async function getVsCodeTerminalPids()
	{
		const pids = new Set();
		const terminals = vscode.window.terminals || [];
		const resolved = await Promise.all(
			terminals.map((t) => (t && typeof t.processId === 'object' ? t.processId.catch(() => null) : Promise.resolve(null)))
		);
		for(const pid of resolved)
		{
			if(pid)
			{
				pids.add(pid);
			}
		}
		return pids;
	}

	function processBelongsToWorkspace(proc, projectDir, workspaceFolders, terminalPids)
	{
		if(terminalPids && terminalPids.has(proc.parentPid))
		{
			return true;
		}
		if(!workspaceFolders || workspaceFolders.length === 0)
		{
			return true;
		}

		const allCmds = [
			proc.commandLine,
			...(proc.childCommandLines || []),
			...(proc.childExecutablePaths || [])
		].join(' ').toLowerCase();

		for(const wf of workspaceFolders)
		{
			const normWf = path.normalize(wf).toLowerCase();
			if(projectDir && path.normalize(projectDir).toLowerCase().startsWith(normWf))
			{
				return true;
			}
			if(allCmds.includes(normWf))
			{
				return true;
			}
		}

		return false;
	}

	function extractProgramHintFromChildren(proc)
	{
		const candidates = [
			...(proc.childExecutablePaths || []),
			...(proc.childCommandLines || [])
		];
		for(const cmd of candidates)
		{
			const match = /(?:"([^"]+\.(?:dll|exe))"|([^\s"]+\.(?:dll|exe)))/gi;
			let m;
			while((m = match.exec(cmd)) !== null)
			{
				const candidate = m[1] || m[2];
				if(candidate
					&& !candidate.includes('=')
					&& !candidate.includes(';')
					&& !/[\\/](?:dotnet(?:\.exe)?|dotnet-watch\.dll|msbuild\.dll|vbcscompiler\.dll|csc\.dll|conhost\.exe|microsoft\.aspnetcore\.watch\.browserrefresh\.dll|microsoft\.extensions\.dotnetdeltaapplier\.dll)$/i.test(candidate))
				{
					return candidate;
				}
			}
		}
		return null;
	}

	function extractChildArgsAndEnv(proc)
	{
		const combined = [proc.commandLine, ...(proc.childCommandLines || [])].join(' ');
		const hints = extractHintsFromArgs(combined);
		let envUrls = null;
		const envMatch = /(?:ASPNETCORE_URLS|DOTNET_URLS)=([^\s"]+|"[^"]+")/i.exec(combined);
		if(envMatch && envMatch[1])
		{
			envUrls = envMatch[1].replace(/^"|"$/g, '');
		}
		return { hints, envUrls };
	}

	async function pollExternalWatchProcesses()
	{
		if(isPolling)
		{
			return;
		}
		const cfg = getConfig();
		if(!cfg.get('enableProcessPolling', true))
		{
			sessionManager.removeWhere((s) => s.source === 'process');
			return;
		}

		isPolling = true;
		try
		{
			const [procs, terminalPids] = await Promise.all([
				findDotnetWatchProcesses(),
				getVsCodeTerminalPids()
			]);
			const workspaceFolders = getWorkspaceFolderPaths();
			const activeProcIds = new Set();

			for(const proc of procs)
			{
				const { hints, envUrls } = extractChildArgsAndEnv(proc);
				const childProgram = extractProgramHintFromChildren(proc);
				const projectDir = resolveProjectDir({
					program: childProgram,
					projectHint: hints.projectHint,
					workspaceFolders
				});

				if(!processBelongsToWorkspace(proc, projectDir, workspaceFolders, terminalPids))
				{
					continue;
				}

				const configResult = readLaunchConfigUrls(projectDir, {
					profileName: hints.profileName,
					envUrls,
					cliUrls: hints.urls
				});

				let urls = configResult.urls;
				let urlSource = configResult.source;

				if(proc.listeningPorts && proc.listeningPorts.length > 0)
				{
					const portSet = new Set(proc.listeningPorts);
					const matchingConfig = urls.filter((u) =>
					{
						try
						{
							const parsed = new URL(u);
							const p = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
							return portSet.has(p);
						}
						catch
						{
							return false;
						}
					});

					if(matchingConfig.length > 0)
					{
						urls = matchingConfig;
					}
					else if(urls.length === 0)
					{
						urls = proc.listeningPorts.map((p) => `http://localhost:${p}`);
						urlSource = 'listening-port';
					}
				}

				const primary = sessionManager.findPrimarySessionFor(projectDir, proc.pid, proc.parentPid);
				if(primary)
				{
					if((!primary.urls || primary.urls.length === 0) && urls.length > 0)
					{
						log(`Enriching primary session (${primary.id}) from process pid=${proc.pid}: ${JSON.stringify(urls)}`);
						sessionManager.upsertSession(primary.id, {
							projectDir: primary.projectDir || projectDir,
							label: configResult.projectName || primary.label,
							configUrls: urls,
							urlSource
						});
					}
					continue;
				}

				const id = `proc:${proc.pid}`;
				activeProcIds.add(id);

				const existing = sessionManager.getActiveSessions().find((s) => s.id === id);
				if(!existing || existing.urls.join(';') !== urls.join(';'))
				{
					log(`Process dotnet watch detected (${id}): projectDir=${projectDir || 'unknown'}, ports=${JSON.stringify(proc.listeningPorts)}, urls=${JSON.stringify(urls)}`);
				}

				sessionManager.upsertSession(id, {
					kind: 'watch',
					source: 'process',
					label: configResult.projectName || `dotnet watch (${proc.pid})`,
					projectDir,
					pid: proc.pid,
					configUrls: urls,
					urlSource
				});
			}

			sessionManager.removeWhere((s) => s.source === 'process' && !activeProcIds.has(s.id));
		}
		catch (err)
		{
			log(`Process polling error: ${err && err.message ? err.message : err}`);
		}
		finally
		{
			isPolling = false;
		}
	}

	function restartPollingTimer()
	{
		if(pollTimer)
		{
			clearInterval(pollTimer);
			pollTimer = null;
		}

		const cfg = getConfig();
		if(!cfg.get('enableProcessPolling', true))
		{
			return;
		}

		const intervalMs = Math.max(1000, Number(cfg.get('pollIntervalMs', 2500)) || 2500);
		pollTimer = setInterval(pollExternalWatchProcesses, intervalMs);
		pollExternalWatchProcesses();
	}

	sessionManager.on('change', updateStatusBar);

	if(vscode.debug.activeDebugSession)
	{
		registerDebugSession(vscode.debug.activeDebugSession);
	}

	context.subscriptions.push(
		output,
		statusBarItem,
		vscode.debug.onDidStartDebugSession(registerDebugSession),
		vscode.debug.onDidTerminateDebugSession((session) =>
		{
			if(session)
			{
				const id = `debug:${session.id}`;
				log(`Debug session ended: ${id}`);
				sessionManager.removeSession(id);
			}
		}),
		vscode.debug.registerDebugAdapterTrackerFactory('coreclr', { createDebugAdapterTracker }),
		vscode.debug.registerDebugAdapterTrackerFactory('dotnet', { createDebugAdapterTracker }),
		vscode.tasks.onDidStartTaskProcess(handleTaskStart),
		vscode.tasks.onDidEndTaskProcess(handleTaskEnd),
		vscode.workspace.onDidChangeConfiguration((e) =>
		{
			if(e.affectsConfiguration('dotnetAppUrl.statusBarAlignment') || e.affectsConfiguration('dotnetAppUrl.statusBarPriority'))
			{
				statusBarItem.dispose();
				statusBarItem = createStatusBarItem();
				context.subscriptions.push(statusBarItem);
			}
			if(e.affectsConfiguration('dotnetAppUrl'))
			{
				updateStatusBar();
				restartPollingTimer();
			}
		}),
		vscode.commands.registerCommand('dotnetAppUrl.open', async () =>
		{
			const sessions = sessionManager.getSessionsWithUrls();
			const preferHttps = Boolean(getConfig().get('preferHttps', true));

			if(sessions.length === 0)
			{
				vscode.window.showInformationMessage('No active dotnet watch or C# debug application URL detected.');
				return;
			}

			if(sessions.length === 1)
			{
				const primary = pickPreferredUrl(sessions[0].urls, preferHttps);
				if(primary)
				{
					await openUrl(primary);
					return;
				}
			}

			await pickAndOpenUrl(sessions);
		}),
		vscode.commands.registerCommand('dotnetAppUrl.pickAndOpen', async () =>
		{
			await pickAndOpenUrl(sessionManager.getSessionsWithUrls());
		}),
		vscode.commands.registerCommand('dotnetAppUrl.refresh', async () =>
		{
			await pollExternalWatchProcesses();
			updateStatusBar();
		}),
		{
			dispose()
			{
				if(pollTimer)
				{
					clearInterval(pollTimer);
					pollTimer = null;
				}
			}
		}
	);

	if(typeof vscode.window.onDidStartTerminalShellExecution === 'function')
	{
		context.subscriptions.push(
			vscode.window.onDidStartTerminalShellExecution(handleShellExecutionStart)
		);
	}
	if(typeof vscode.window.onDidEndTerminalShellExecution === 'function')
	{
		context.subscriptions.push(
			vscode.window.onDidEndTerminalShellExecution(handleShellExecutionEnd)
		);
	}

	restartPollingTimer();
	updateStatusBar();
	log('.NET Application URL Launcher activated.');
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
