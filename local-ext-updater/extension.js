const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

function isNewer(nextVer, currVer)
{
	const a = nextVer.split('.').map(part => parseInt(part, 10) || 0)
	const b = currVer.split('.').map(part => parseInt(part, 10) || 0)
	const len = Math.max(a.length, b.length)
	for(let i = 0; i < len; i++)
	{
		const numA = a[i] || 0
		const numB = b[i] || 0
		if(numA > numB)
		{
			return true
		}
		if(numA < numB)
		{
			return false
		}
	}
	return false
}

function findVsixFiles(dir)
{
	const results = []
	const entries = fs.readdirSync(dir, { withFileTypes: true })
	for(const entry of entries)
	{
		if(entry.isDirectory())
		{
			if(entry.name.startsWith('.') || entry.name === 'node_modules')
			{
				continue
			}
			results.push(...findVsixFiles(path.join(dir, entry.name)))
		}
		else if(entry.isFile() && entry.name.endsWith('.vsix'))
		{
			results.push(path.join(dir, entry.name))
		}
	}
	return results
}

function extractZipEntry(filePath, targetName)
{
	const buf = fs.readFileSync(filePath)
	let eocd = -1
	for(let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
	{
		if(buf.readUInt32LE(i) === 0x06054b50)
		{
			eocd = i
			break
		}
	}
	if(eocd === -1)
	{
		return null
	}

	const cdSize = buf.readUInt32LE(eocd + 12)
	const cdOffset = buf.readUInt32LE(eocd + 16)
	let offset = cdOffset

	while(offset < cdOffset + cdSize)
	{
		if(buf.readUInt32LE(offset) !== 0x02014b50)
		{
			break
		}
		const method = buf.readUInt16LE(offset + 10)
		const compSize = buf.readUInt32LE(offset + 20)
		const nameLen = buf.readUInt16LE(offset + 28)
		const extraLen = buf.readUInt16LE(offset + 30)
		const commentLen = buf.readUInt16LE(offset + 32)
		const localOffset = buf.readUInt32LE(offset + 42)
		const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)

		if(name === targetName)
		{
			const lhNameLen = buf.readUInt16LE(localOffset + 26)
			const lhExtraLen = buf.readUInt16LE(localOffset + 28)
			const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
			const raw = buf.subarray(dataStart, dataStart + compSize)

			if(method === 0)
			{
				return raw.toString('utf8')
			}
			if(method === 8)
			{
				return zlib.inflateRawSync(raw).toString('utf8')
			}
			return null
		}

		offset += 46 + nameLen + extraLen + commentLen
	}
	return null
}

function readVsixMeta(filePath)
{
	const text = extractZipEntry(filePath, 'extension/package.json')
	if(!text)
	{
		return null
	}
	const pkg = JSON.parse(text)
	if(!pkg.publisher || !pkg.name || !pkg.version)
	{
		return null
	}
	return {
		id: `${pkg.publisher}.${pkg.name}`.toLowerCase(),
		version: pkg.version,
		filePath
	}
}

function readExtensionsManifest(manifestPath, extensionsDir)
{
	if(!fs.existsSync(manifestPath))
	{
		return null
	}
	try
	{
		const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
		if(!Array.isArray(entries))
		{
			return null
		}
		const result = []
		for(const entry of entries)
		{
			const id = entry?.identifier?.id?.toLowerCase()
			const version = entry?.version
			if(!id || !version)
			{
				continue
			}
			if(extensionsDir && entry.relativeLocation)
			{
				if(!fs.existsSync(path.join(extensionsDir, entry.relativeLocation)))
				{
					continue
				}
			}
			result.push({
				id,
				version,
				isApplicationScoped: Boolean(entry?.metadata?.isApplicationScoped)
			})
		}
		return result
	}
	catch(err)
	{
		console.error(`Failed to read ${manifestPath}:`, err)
		return null
	}
}

function getInstalledExtensions(context)
{
	const installed = new Map()
	const record = (id, version) =>
	{
		const existing = installed.get(id)
		if(!existing || isNewer(version, existing))
		{
			installed.set(id, version)
		}
	}

	for(const ext of vscode.extensions.all)
	{
		if(ext.packageJSON?.version)
		{
			record(ext.id.toLowerCase(), ext.packageJSON.version)
		}
	}

	const siblingDir = context?.extensionPath ? path.dirname(context.extensionPath) : null
	const extensionsDir = siblingDir && fs.existsSync(path.join(siblingDir, 'extensions.json'))
		? siblingDir
		: path.join(os.homedir(), '.vscode', 'extensions')

	const defaultManifestPath = path.join(extensionsDir, 'extensions.json')
	const profileDir = context?.globalStorageUri
		? path.dirname(path.dirname(context.globalStorageUri.fsPath))
		: null
	const profileManifestPath = profileDir ? path.join(profileDir, 'extensions.json') : null

	if(profileManifestPath && fs.existsSync(profileManifestPath))
	{
		const profileEntries = readExtensionsManifest(profileManifestPath, extensionsDir)
		if(profileEntries)
		{
			for(const entry of profileEntries)
			{
				record(entry.id, entry.version)
			}
		}
		const defaultEntries = readExtensionsManifest(defaultManifestPath, extensionsDir)
		if(defaultEntries)
		{
			for(const entry of defaultEntries)
			{
				if(entry.isApplicationScoped)
				{
					record(entry.id, entry.version)
				}
			}
		}
	}
	else
	{
		const defaultEntries = readExtensionsManifest(defaultManifestPath, extensionsDir)
		if(defaultEntries)
		{
			for(const entry of defaultEntries)
			{
				record(entry.id, entry.version)
			}
		}
	}

	return installed
}

async function updateLocalExtensions(context)
{
	const config = vscode.workspace.getConfiguration('localExtUpdater')
	const folderPath = config.get('folderPath')

	if(!folderPath || !fs.existsSync(folderPath))
	{
		vscode.window.showErrorMessage('Set a valid folder path in localExtUpdater.folderPath')
		return
	}

	const files = findVsixFiles(folderPath)
	if(files.length === 0)
	{
		vscode.window.showInformationMessage('No .vsix files found in the configured folder')
		return
	}

	const latestById = new Map()
	for(const filePath of files)
	{
		try
		{
			const meta = readVsixMeta(filePath)
			if(!meta)
			{
				continue
			}
			const existing = latestById.get(meta.id)
			if(!existing || isNewer(meta.version, existing.version))
			{
				latestById.set(meta.id, meta)
			}
		}
		catch(err)
		{
			console.error(`Failed to read ${filePath}:`, err)
		}
	}

	const installed = getInstalledExtensions(context)

	const updated = []
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Checking local extensions...'
		},
		async progress =>
		{
			for(const [id, meta] of latestById)
			{
				const currVer = installed.get(id)
				if(!currVer || isNewer(meta.version, currVer))
				{
					progress.report({ message: `Installing ${id} v${meta.version}` })
					await vscode.commands.executeCommand(
						'workbench.extensions.installExtension',
						vscode.Uri.file(meta.filePath)
					)
					updated.push(`${id} (${currVer || 'new'} -> ${meta.version})`)
				}
			}
		}
	)

	if(updated.length === 0)
	{
		vscode.window.showInformationMessage('All local extensions are up to date')
		return
	}

	const choice = await vscode.window.showInformationMessage(
		`Updated ${updated.length} extension(s): ${updated.join(', ')}`,
		'Reload Window'
	)
	if(choice === 'Reload Window')
	{
		vscode.commands.executeCommand('workbench.action.reloadWindow')
	}
}

function activate(context)
{
	const cmdId = 'localExtUpdater.update'
	const disposable = vscode.commands.registerCommand(cmdId, () => updateLocalExtensions(context))

	const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
	button.text = '$(sync) Update Local Exts'
	button.tooltip = 'Check and update custom extensions from local folder'
	button.command = cmdId
	button.show()

	context.subscriptions.push(disposable, button)
}

function deactivate()
{}

module.exports = { activate, deactivate }