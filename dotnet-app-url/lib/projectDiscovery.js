'use strict';

const fs = require('fs');
const path = require('path');
const {
	parseJsonc,
	splitApplicationUrls,
	resolveUrlsFromLaunchSettings,
	resolveUrlsFromAppSettings
} = require('./urlParser');

/**
 * Checks whether a directory contains a .csproj, .fsproj, or Properties/launchSettings.json.
 * @param {string} dirPath
 * @returns {{ projectName: string | null, hasLaunchSettings: boolean, isProjectDir: boolean }}
 */
function inspectDirectory(dirPath)
{
	try
	{
		if(!dirPath || !fs.existsSync(dirPath))
		{
			return { projectName: null, hasLaunchSettings: false, isProjectDir: false };
		}

		const stat = fs.statSync(dirPath);
		if(!stat.isDirectory())
		{
			return { projectName: null, hasLaunchSettings: false, isProjectDir: false };
		}

		const entries = fs.readdirSync(dirPath);
		const projFile = entries.find((e) => /\.(?:cs|fs)proj$/i.test(e));
		const hasLaunchSettings = fs.existsSync(path.join(dirPath, 'Properties', 'launchSettings.json'));
		const projectName = projFile ? path.basename(projFile, path.extname(projFile)) : null;

		return {
			projectName,
			hasLaunchSettings,
			isProjectDir: Boolean(projFile || hasLaunchSettings)
		};
	}
	catch
	{
		return { projectName: null, hasLaunchSettings: false, isProjectDir: false };
	}
}

/**
 * Walks up from a starting path (file or directory) to find the nearest .NET project directory.
 * @param {string | null | undefined} startPath
 * @param {number} [maxLevels=6]
 * @returns {string | null}
 */
function findNearestProjectDir(startPath, maxLevels = 6)
{
	if(!startPath || typeof startPath !== 'string')
	{
		return null;
	}

	let current = startPath;
	try
	{
		if(fs.existsSync(current) && fs.statSync(current).isFile())
		{
			current = path.dirname(current);
		}
		else if(/\.[a-z0-9]+$/i.test(path.basename(current)) && !fs.existsSync(current))
		{
			current = path.dirname(current);
		}
	}
	catch
	{
		current = path.dirname(current);
	}

	for(let i = 0; i <= maxLevels; i++)
	{
		const info = inspectDirectory(current);
		if(info.isProjectDir)
		{
			return current;
		}
		const parent = path.dirname(current);
		if(!parent || parent === current)
		{
			break;
		}
		current = parent;
	}

	return null;
}

/**
 * Resolves the project directory from debug/watch hints.
 * @param {{
 *   cwd?: string | null,
 *   program?: string | null,
 *   projectHint?: string | null,
 *   launchSettingsFilePath?: string | null,
 *   workspaceFolders?: string[]
 * }} hints
 * @returns {string | null}
 */
function resolveProjectDir(hints = {})
{
	const { cwd, program, projectHint, launchSettingsFilePath, workspaceFolders = [] } = hints;

	if(launchSettingsFilePath)
	{
		const resolvedLs = path.isAbsolute(launchSettingsFilePath)
			? launchSettingsFilePath
			: (cwd ? path.resolve(cwd, launchSettingsFilePath) : null);
		if(resolvedLs)
		{
			const dir = path.dirname(resolvedLs);
			if(path.basename(dir).toLowerCase() === 'properties')
			{
				return path.dirname(dir);
			}
			const found = findNearestProjectDir(dir);
			if(found)
			{
				return found;
			}
		}
	}

	if(projectHint)
	{
		const candidate = path.isAbsolute(projectHint)
			? projectHint
			: (cwd ? path.resolve(cwd, projectHint) : (workspaceFolders[0] ? path.resolve(workspaceFolders[0], projectHint) : null));
		const found = findNearestProjectDir(candidate);
		if(found)
		{
			return found;
		}
	}

	if(program)
	{
		const resolvedProgram = path.isAbsolute(program)
			? program
			: (cwd ? path.resolve(cwd, program) : null);
		const found = findNearestProjectDir(resolvedProgram);
		if(found)
		{
			return found;
		}
	}

	if(cwd)
	{
		const found = findNearestProjectDir(cwd);
		if(found)
		{
			return found;
		}
	}

	return null;
}

/**
 * Reads application URLs from launchSettings.json, env vars, and appsettings*.json.
 * @param {string | null} projectDir
 * @param {{
 *   profileName?: string | null,
 *   envUrls?: string | null,
 *   launchSettingsFilePath?: string | null,
 *   cliUrls?: string[]
 * }} [options]
 * @returns {{ urls: string[], projectName: string | null, profileName: string | null, source: string | null }}
 */
function readLaunchConfigUrls(projectDir, options = {})
{
	const { profileName = null, envUrls = null, launchSettingsFilePath = null, cliUrls = [] } = options;

	let projectName = null;
	if(projectDir)
	{
		const info = inspectDirectory(projectDir);
		projectName = info.projectName || path.basename(projectDir);
	}

	if(Array.isArray(cliUrls) && cliUrls.length > 0)
	{
		return {
			urls: Array.from(new Set(cliUrls)),
			projectName,
			profileName,
			source: 'cli-urls'
		};
	}

	if(envUrls)
	{
		const parsedEnv = splitApplicationUrls(envUrls);
		if(parsedEnv.length > 0)
		{
			return {
				urls: parsedEnv,
				projectName,
				profileName,
				source: 'ASPNETCORE_URLS'
			};
		}
	}

	const lsPath = launchSettingsFilePath && fs.existsSync(launchSettingsFilePath)
		? launchSettingsFilePath
		: (projectDir ? path.join(projectDir, 'Properties', 'launchSettings.json') : null);

	if(lsPath && fs.existsSync(lsPath))
	{
		try
		{
			const raw = fs.readFileSync(lsPath, 'utf8');
			const parsed = parseJsonc(raw);
			const resolved = resolveUrlsFromLaunchSettings(parsed, profileName);
			if(resolved.urls.length > 0)
			{
				return {
					urls: resolved.urls,
					projectName,
					profileName: resolved.profileName,
					source: 'launchSettings.json'
				};
			}
		}
		catch
		{
			// ignore read/parse errors
		}
	}

	if(projectDir)
	{
		for(const fileName of ['appsettings.Development.json', 'appsettings.json'])
		{
			const appSettingsPath = path.join(projectDir, fileName);
			if(fs.existsSync(appSettingsPath))
			{
				try
				{
					const raw = fs.readFileSync(appSettingsPath, 'utf8');
					const parsed = parseJsonc(raw);
					const urls = resolveUrlsFromAppSettings(parsed);
					if(urls.length > 0)
					{
						return {
							urls,
							projectName,
							profileName,
							source: fileName
						};
					}
				}
				catch
				{
					// ignore
				}
			}
		}
	}

	return {
		urls: [],
		projectName,
		profileName,
		source: null
	};
}

module.exports = {
	inspectDirectory,
	findNearestProjectDir,
	resolveProjectDir,
	readLaunchConfigUrls
};
