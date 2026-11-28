const vscode = require('vscode')
const { DEFAULT_PATTERNS, createStreamMatcher } = require('./matcher')

// Common Ctrl+C / SIGINT exit codes (POSIX 130, Windows STATUS_CONTROL_C_EXIT)
const INTERRUPT_EXIT_CODES = new Set([130, 3221225786, -1073741510])

function getSettings()
{
	const config = vscode.workspace.getConfiguration('autoRevealException')
	return {
		patterns: config.get('patterns', DEFAULT_PATTERNS),
		caseSensitive: config.get('caseSensitive', false),
		revealOnNonZeroExitCode: config.get('revealOnNonZeroExitCode', true),
		preserveFocus: config.get('preserveFocus', true),
		cooldownMs: Math.max(0, config.get('cooldownMs', 500))
	}
}

function activate(context)
{
	const output = vscode.window.createOutputChannel('Auto Reveal Exception')
	const lastShownAt = new WeakMap()
	let settings = getSettings()
	let isDisposed = false

	function log(message)
	{
		if(!isDisposed)
		{
			output.appendLine(`[${new Date().toISOString()}] ${message}`)
		}
	}

	function revealTerminal(terminal, reason)
	{
		if(!terminal || terminal.exitStatus !== undefined)
		{
			return
		}

		const now = Date.now()
		const previous = lastShownAt.get(terminal) || 0
		if(now - previous < settings.cooldownMs)
		{
			return
		}

		lastShownAt.set(terminal, now)
		log(`Revealing terminal "${terminal.name}" (${reason})`)

		try
		{
			terminal.show(settings.preserveFocus)
		}
		catch(err)
		{
			log(`Failed to reveal terminal "${terminal.name}": ${err && err.message ? err.message : String(err)}`)
		}
	}

	const configDisposable = vscode.workspace.onDidChangeConfiguration(e =>
	{
		if(e.affectsConfiguration('autoRevealException'))
		{
			settings = getSettings()
			log('Reloaded configuration')
		}
	})

	const startDisposable = vscode.window.onDidStartTerminalShellExecution(async e =>
	{
		const stream = e.execution.read()
		const matcher = createStreamMatcher({
			patterns: settings.patterns,
			caseSensitive: settings.caseSensitive
		})

		try
		{
			for await(const data of stream)
			{
				const result = matcher.push(data)
				if(result.matched)
				{
					revealTerminal(e.terminal, `matched "${result.matchText}"`)
				}
			}
		}
		catch(err)
		{
			log(`Error reading execution stream for "${e.terminal.name}": ${err && err.message ? err.message : String(err)}`)
		}
	})

	const endDisposable = vscode.window.onDidEndTerminalShellExecution(e =>
	{
		if(!settings.revealOnNonZeroExitCode)
		{
			return
		}

		if(e.exitCode !== undefined && e.exitCode !== 0 && !INTERRUPT_EXIT_CODES.has(e.exitCode))
		{
			revealTerminal(e.terminal, `exit code ${e.exitCode}`)
		}
	})

	const closeDisposable = vscode.window.onDidCloseTerminal(terminal =>
	{
		lastShownAt.delete(terminal)
	})

	function checkShellIntegration(terminal)
	{
		if(!terminal || terminal.exitStatus !== undefined || terminal.shellIntegration)
		{
			return
		}

		const timer = setTimeout(() =>
		{
			if(!isDisposed && terminal.exitStatus === undefined && !terminal.shellIntegration)
			{
				log(`Warning: Shell integration is not active on "${terminal.name}". VS Code will not fire command execution events for this terminal.`)
			}
		}, 4000)

		if(typeof timer.unref === 'function')
		{
			timer.unref()
		}
	}

	const openDisposable = vscode.window.onDidOpenTerminal(terminal =>
	{
		checkShellIntegration(terminal)
	})

	for(const terminal of vscode.window.terminals || [])
	{
		checkShellIntegration(terminal)
	}

	context.subscriptions.push(
		{ dispose() { isDisposed = true } },
		output,
		configDisposable,
		startDisposable,
		endDisposable,
		closeDisposable,
		openDisposable
	)
}

module.exports = { activate }
