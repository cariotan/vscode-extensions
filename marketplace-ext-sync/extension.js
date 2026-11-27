const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const os = require('os')
const zlib = require('zlib')
const https = require('https')

const GALLERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'

function compareVersions(a, b)
{
	const pa = String(a).split('-')[0].split('.').map(part => parseInt(part, 10) || 0)
	const pb = String(b).split('-')[0].split('.').map(part => parseInt(part, 10) || 0)
	const len = Math.max(pa.length, pb.length)
	for(let i = 0; i < len; i++)
	{
		const numA = pa[i] || 0
		const numB = pb[i] || 0
		if(numA > numB)
		{
			return 1
		}
		if(numA < numB)
		{
			return -1
		}
	}
	return 0
}

function isNewer(nextVer, currVer)
{
	return compareVersions(nextVer, currVer) > 0
}

function isEngineCompatible(engineRange, currentVsCodeVersion)
{
	if(!engineRange || engineRange === '*')
	{
		return true
	}
	const cleaned = engineRange.trim()
	const match = cleaned.match(/^(\^|>=|>|=)?\s*(\d+\.\d+\.\d+)/)
	if(!match)
	{
		return true
	}
	const op = match[1] || ''
	const minVer = match[2]
	if(op === '>' )
	{
		return compareVersions(currentVsCodeVersion, minVer) > 0
	}
	return compareVersions(currentVsCodeVersion, minVer) >= 0
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
	const manifest = extractZipEntry(filePath, 'extension.vsixmanifest')
	const tpMatch = manifest ? manifest.match(/TargetPlatform="([^"]+)"/) : null
	return {
		id: `${pkg.publisher}.${pkg.name}`.toLowerCase(),
		version: pkg.version,
		targetPlatform: tpMatch ? tpMatch[1] : 'universal',
		filePath
	}
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

function postJson(url, bodyObj)
{
	return new Promise((resolve, reject) =>
	{
		const payload = JSON.stringify(bodyObj)
		const parsed = new URL(url)
		const req = https.request(
			{
				hostname: parsed.hostname,
				path: parsed.pathname + parsed.search,
				method: 'POST',
				headers: {
					'Accept': 'application/json;api-version=3.0-preview.1',
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload)
				}
			},
			res =>
			{
				const chunks = []
				res.on('data', chunk => chunks.push(chunk))
				res.on('end', () =>
				{
					const raw = Buffer.concat(chunks).toString('utf8')
					if(res.statusCode < 200 || res.statusCode >= 300)
					{
						reject(new Error(`Marketplace API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`))
						return
					}
					try
					{
						resolve(JSON.parse(raw))
					}
					catch(err)
					{
						reject(err)
					}
				})
			}
		)
		req.on('error', reject)
		req.write(payload)
		req.end()
	})
}

function downloadBuffer(url, redirectsLeft = 5)
{
	return new Promise((resolve, reject) =>
	{
		https.get(url, res =>
		{
			if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0)
			{
				res.resume()
				const nextUrl = new URL(res.headers.location, url).toString()
				resolve(downloadBuffer(nextUrl, redirectsLeft - 1))
				return
			}
			if(res.statusCode < 200 || res.statusCode >= 300)
			{
				res.resume()
				reject(new Error(`Download failed with HTTP ${res.statusCode}`))
				return
			}
			const chunks = []
			res.on('data', chunk => chunks.push(chunk))
			res.on('end', () => resolve(Buffer.concat(chunks)))
		}).on('error', reject)
	})
}

function getInstalledFromDisk()
{
	const extRoot = path.join(os.homedir(), '.vscode', 'extensions')
	const jsonPath = path.join(extRoot, 'extensions.json')
	if(!fs.existsSync(jsonPath))
	{
		return null
	}

	const entries = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
	return entries
		.filter(item => item?.identifier?.id && item?.version)
		.map(item =>
		{
			let targetPlatform = 'universal'
			if(item.relativeLocation)
			{
				const manifestPath = path.join(extRoot, item.relativeLocation, '.vsixmanifest')
				if(fs.existsSync(manifestPath))
				{
					const manifest = fs.readFileSync(manifestPath, 'utf8')
					const tpMatch = manifest.match(/TargetPlatform="([^"]+)"/)
					if(tpMatch)
					{
						targetPlatform = tpMatch[1]
					}
				}
			}
			return {
				id: item.identifier.id.toLowerCase(),
				version: item.version,
				targetPlatform,
				isPreRelease: Boolean(item.metadata?.isPreReleaseVersion)
			}
		})
}

async function syncMarketplaceExtensions(output)
{
	const config = vscode.workspace.getConfiguration('marketplaceExtSync')
	const folderPath = (config.get('folderPath') || '').trim()
	const installOutdated = config.get('installOutdated', true)

	if(!folderPath)
	{
		vscode.window.showErrorMessage('Set a valid folder path in marketplaceExtSync.folderPath')
		return
	}

	if(!fs.existsSync(folderPath))
	{
		fs.mkdirSync(folderPath, { recursive: true })
	}

	const installedList = getInstalledFromDisk()
	if(!installedList || installedList.length === 0)
	{
		vscode.window.showInformationMessage('No installed VS Code extensions found in extensions.json')
		return
	}

	output.clear()
	output.appendLine(`[${new Date().toLocaleTimeString()}] Scanning ${installedList.length} installed extension(s)...`)

	const existingById = new Map()
	for(const filePath of findVsixFiles(folderPath))
	{
		try
		{
			const meta = readVsixMeta(filePath)
			if(!meta)
			{
				continue
			}
			const existing = existingById.get(meta.id)
			if(!existing || isNewer(meta.version, existing.version))
			{
				existingById.set(meta.id, meta)
			}
		}
		catch(err)
		{
			output.appendLine(`Warning: failed reading ${filePath}: ${err.message}`)
		}
	}

	const downloaded = []
	const updated = []
	const skipped = []
	const errors = []

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Syncing Marketplace Extensions...',
			cancellable: true
		},
		async (progress, token) =>
		{
			progress.report({ message: 'Querying VS Code Marketplace...' })
			let mktById
			try
			{
				const resp = await postJson(GALLERY_URL, {
					filters: [
						{
							criteria: installedList.map(e => ({ filterType: 7, value: e.id })),
							pageNumber: 1,
							pageSize: Math.max(50, installedList.length)
						}
					],
					flags: 0x1 | 0x2 | 0x10 | 0x80
				})
				const results = resp?.results?.[0]?.extensions || []
				mktById = new Map(
					results.map(x => [`${x.publisher.publisherName}.${x.extensionName}`.toLowerCase(), x])
				)
			}
			catch(err)
			{
				output.appendLine(`Marketplace query failed: ${err.message}`)
				vscode.window.showErrorMessage(`Marketplace query failed: ${err.message}`)
				return
			}


			for(const ext of installedList)
			{
				if(token.isCancellationRequested)
				{
					output.appendLine('Sync cancelled by user.')
					break
				}

				const mkt = mktById.get(ext.id)
				if(!mkt)
				{
					skipped.push(ext.id)
					output.appendLine(`Skipped (local / not on Marketplace): ${ext.id}@${ext.version}`)
					continue
				}

				const isPre = v => v.properties?.some(
					p => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && p.value === 'true'
				)
				const getEngine = v => v.properties?.find(
					p => p.key === 'Microsoft.VisualStudio.Code.Engine'
				)?.value
				const matchesPlatform = v => (
					ext.targetPlatform === 'universal'
						? !v.targetPlatform
						: v.targetPlatform === ext.targetPlatform
				)

				const targetVer = mkt.versions?.find(v =>
					(ext.isPreRelease || !isPre(v)) &&
					matchesPlatform(v) &&
					isEngineCompatible(getEngine(v), vscode.version)
				)

				if(!targetVer)
				{
					skipped.push(ext.id)
					output.appendLine(`Skipped (no compatible Marketplace build for ${ext.targetPlatform}): ${ext.id}`)
					continue
				}

				const existing = existingById.get(ext.id)
				const outdatedInVsCode = isNewer(targetVer.version, ext.version)
				const hasExactInFolder = existing && existing.version === targetVer.version

				if(hasExactInFolder && !outdatedInVsCode)
				{
					skipped.push(ext.id)
					output.appendLine(`Skipped (same version in folder): ${ext.id}@${targetVer.version}`)
					continue
				}

				let vsixPath = hasExactInFolder ? existing.filePath : null
				if(!vsixPath)
				{
					const vsixAsset = targetVer.files?.find(
						f => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage'
					)
					if(!vsixAsset?.source)
					{
						errors.push(`${ext.id}: missing VSIX download URL`)
						output.appendLine(`Error: no VSIX URL for ${ext.id}@${targetVer.version}`)
						continue
					}

					const fileName = ext.targetPlatform === 'universal'
						? `${ext.id}-${targetVer.version}.vsix`
						: `${ext.id}-${targetVer.version}-${ext.targetPlatform}.vsix`
					const destPath = path.join(folderPath, fileName)
					const tmpPath = destPath + '.tmp'

					progress.report({ message: `Downloading ${fileName}...` })
					try
					{
						const buf = await downloadBuffer(vsixAsset.source)
						fs.writeFileSync(tmpPath, buf)
						const meta = readVsixMeta(tmpPath)
						if(!meta || meta.id !== ext.id || meta.version !== targetVer.version)
						{
							throw new Error('Downloaded VSIX metadata mismatch')
						}
						fs.renameSync(tmpPath, destPath)
						vsixPath = destPath
						downloaded.push(`${ext.id}@${targetVer.version}`)
						output.appendLine(`Downloaded: ${fileName} (${buf.length} bytes)`)
					}
					catch(err)
					{
						if(fs.existsSync(tmpPath))
						{
							fs.unlinkSync(tmpPath)
						}
						errors.push(`${ext.id}: ${err.message}`)
						output.appendLine(`Error downloading ${ext.id}: ${err.message}`)
						continue
					}
				}

				if(installOutdated && outdatedInVsCode && vsixPath)
				{
					progress.report({ message: `Installing ${ext.id} v${targetVer.version}...` })
					try
					{
						await vscode.commands.executeCommand(
							'workbench.extensions.installExtension',
							vscode.Uri.file(vsixPath)
						)
						updated.push(`${ext.id} (${ext.version} -> ${targetVer.version})`)
						output.appendLine(`Installed update: ${ext.id} (${ext.version} -> ${targetVer.version})`)
					}
					catch(err)
					{
						errors.push(`${ext.id} install: ${err.message}`)
						output.appendLine(`Error installing ${ext.id}: ${err.message}`)
					}
				}
			}
		}
	)

	if(errors.length > 0)
	{
		output.show(true)
		vscode.window.showWarningMessage(
			`Sync finished with ${errors.length} error(s). Downloaded: ${downloaded.length}, Installed: ${updated.length}. Check Output for details.`
		)
		return
	}

	if(downloaded.length === 0 && updated.length === 0)
	{
		vscode.window.showInformationMessage('All Marketplace extensions and .vsix files are up to date')
		return
	}

	if(updated.length > 0)
	{
		const choice = await vscode.window.showInformationMessage(
			`Downloaded ${downloaded.length} .vsix, updated ${updated.length} extension(s): ${updated.join(', ')}`,
			'Reload Window'
		)
		if(choice === 'Reload Window')
		{
			vscode.commands.executeCommand('workbench.action.reloadWindow')
		}
		return
	}

	vscode.window.showInformationMessage(
		`Downloaded ${downloaded.length} missing .vsix file(s): ${downloaded.join(', ')}`
	)
}

function activate(context)
{
	const output = vscode.window.createOutputChannel('Marketplace Extension Sync')
	const cmdId = 'marketplaceExtSync.sync'
	const disposable = vscode.commands.registerCommand(cmdId, () => syncMarketplaceExtensions(output))

	const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99)
	button.text = '$(cloud-download) Sync Marketplace Exts'
	button.tooltip = 'Download missing/updated Marketplace .vsix files and install outdated extensions'
	button.command = cmdId

	const updateButtonVisibility = () =>
	{
		const show = vscode.workspace.getConfiguration('marketplaceExtSync').get('showStatusBarButton', true)
		if(show)
		{
			button.show()
		}
		else
		{
			button.hide()
		}
	}

	updateButtonVisibility()
	const configListener = vscode.workspace.onDidChangeConfiguration(e =>
	{
		if(e.affectsConfiguration('marketplaceExtSync.showStatusBarButton'))
		{
			updateButtonVisibility()
		}
	})

	context.subscriptions.push(output, disposable, button, configListener)
}

function deactivate()
{}

module.exports = { activate, deactivate }

