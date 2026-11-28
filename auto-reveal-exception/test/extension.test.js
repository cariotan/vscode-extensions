const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

function loadExtensionWithMockVscode(configOverrides = {})
{
	const listeners = {
		startExecution: null,
		endExecution: null,
		closeTerminal: null,
		openTerminal: null,
		changeConfig: null
	}
	const logs = []

	const mockVscode = {
		window: {
			terminals: [],
			createOutputChannel()
			{
				return {
					appendLine(line) { logs.push(line) },
					dispose() {}
				}
			},
			onDidStartTerminalShellExecution(cb)
			{
				listeners.startExecution = cb
				return { dispose() {} }
			},
			onDidEndTerminalShellExecution(cb)
			{
				listeners.endExecution = cb
				return { dispose() {} }
			},
			onDidCloseTerminal(cb)
			{
				listeners.closeTerminal = cb
				return { dispose() {} }
			},
			onDidOpenTerminal(cb)
			{
				listeners.openTerminal = cb
				return { dispose() {} }
			}
		},
		workspace: {
			getConfiguration()
			{
				return {
					get(key, defaultValue)
					{
						return key in configOverrides ? configOverrides[key] : defaultValue
					}
				}
			},
			onDidChangeConfiguration(cb)
			{
				listeners.changeConfig = cb
				return { dispose() {} }
			}
		}
	}

	const originalLoad = Module._load
	const extensionPath = path.resolve(__dirname, '../extension.js')
	delete require.cache[extensionPath]

	Module._load = function(request, parent, isMain)
	{
		if(request === 'vscode')
		{
			return mockVscode
		}
		return originalLoad.call(this, request, parent, isMain)
	}

	try
	{
		const ext = require(extensionPath)
		const context = { subscriptions: [] }
		ext.activate(context)
		return { listeners, logs, context }
	}
	finally
	{
		Module._load = originalLoad
	}
}

test('reveals terminal when split exception arrives across chunks', async () =>
{
	const { listeners } = loadExtensionWithMockVscode({ cooldownMs: 0 })
	const showCalls = []
	const terminal = {
		name: 'pwsh',
		exitStatus: undefined,
		show(preserveFocus) { showCalls.push(preserveFocus) }
	}

	async function* fakeStream()
	{
		yield 'Starting build...\n'
		yield 'Something crashed: Excep'
		yield 'tion in worker\n'
	}

	await listeners.startExecution({
		terminal,
		execution: { read: fakeStream }
	})

	assert.deepEqual(showCalls, [true])
})

test('reveals terminal on non-zero exit code and ignores Ctrl+C exit codes', () =>
{
	const { listeners } = loadExtensionWithMockVscode({ cooldownMs: 0 })
	const showCalls = []
	const terminal = {
		name: 'bash',
		exitStatus: undefined,
		show(preserveFocus) { showCalls.push(preserveFocus) }
	}

	listeners.endExecution({ terminal, exitCode: 0 })
	assert.equal(showCalls.length, 0)

	listeners.endExecution({ terminal, exitCode: 130 })
	assert.equal(showCalls.length, 0)

	listeners.endExecution({ terminal, exitCode: 1 })
	assert.deepEqual(showCalls, [true])
})

test('debounces repeated show calls within cooldownMs', async () =>
{
	const { listeners } = loadExtensionWithMockVscode({ cooldownMs: 5000 })
	const showCalls = []
	const terminal = {
		name: 'pwsh',
		exitStatus: undefined,
		show(preserveFocus) { showCalls.push(preserveFocus) }
	}

	async function* fakeStream()
	{
		yield 'Error: first\n'
		yield 'Error: second\n'
		yield 'Exception: third\n'
	}

	await listeners.startExecution({
		terminal,
		execution: { read: fakeStream }
	})

	assert.equal(showCalls.length, 1)
})
