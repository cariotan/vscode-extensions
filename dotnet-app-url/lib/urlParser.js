'use strict';

/**
 * Removes ANSI escape codes from terminal/debug output.
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text)
{
	if(!text || typeof text !== 'string')
	{
		return '';
	}
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g, '');
}

/**
 * Strips // and /* *\/ comments and trailing commas from JSONC text while preserving strings.
 * @param {string} text
 * @returns {string}
 */
function stripJsonComments(text)
{
	if(!text || typeof text !== 'string')
	{
		return '';
	}

	let out = '';
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	for(let i = 0; i < text.length; i++)
	{
		const ch = text[i];
		const next = i + 1 < text.length ? text[i + 1] : '';

		if(inLineComment)
		{
			if(ch === '\n' || ch === '\r')
			{
				inLineComment = false;
				out += ch;
			}
			continue;
		}

		if(inBlockComment)
		{
			if(ch === '*' && next === '/')
			{
				inBlockComment = false;
				i++;
			}
			else if(ch === '\n' || ch === '\r')
			{
				out += ch;
			}
			continue;
		}

		if(inString)
		{
			out += ch;
			if(escaped)
			{
				escaped = false;
			}
			else if(ch === '\\')
			{
				escaped = true;
			}
			else if(ch === '"')
			{
				inString = false;
			}
			continue;
		}

		if(ch === '"')
		{
			inString = true;
			out += ch;
			continue;
		}

		if(ch === '/' && next === '/')
		{
			inLineComment = true;
			i++;
			continue;
		}

		if(ch === '/' && next === '*')
		{
			inBlockComment = true;
			i++;
			continue;
		}

		out += ch;
	}

	let cleaned = '';
	inString = false;
	escaped = false;
	for(let i = 0; i < out.length; i++)
	{
		const ch = out[i];
		if(inString)
		{
			cleaned += ch;
			if(escaped)
			{
				escaped = false;
			}
			else if(ch === '\\')
			{
				escaped = true;
			}
			else if(ch === '"')
			{
				inString = false;
			}
			continue;
		}

		if(ch === '"')
		{
			inString = true;
			cleaned += ch;
			continue;
		}

		if(ch === ',')
		{
			let j = i + 1;
			while(j < out.length && /\s/.test(out[j]))
			{
				j++;
			}
			if(j < out.length && (out[j] === '}' || out[j] === ']'))
			{
				continue;
			}
		}

		cleaned += ch;
	}

	return cleaned.replace(/^\uFEFF/, '');
}

/**
 * Safely parses JSON or JSONC content.
 * @param {string} text
 * @returns {any | null}
 */
function parseJsonc(text)
{
	try
	{
		return JSON.parse(stripJsonComments(text));
	}
	catch
	{
		return null;
	}
}

/**
 * Normalizes a Kestrel/launchSettings URL so wildcard hosts become localhost.
 * @param {string} rawUrl
 * @returns {string | null}
 */
function normalizeLaunchUrl(rawUrl)
{
	if(!rawUrl || typeof rawUrl !== 'string')
	{
		return null;
	}

	let url = rawUrl.trim().replace(/[),.;]+$/, '');
	if(!/^https?:\/\//i.test(url))
	{
		return null;
	}

	url = url.replace(
		/^(https?:\/\/)(?:0\.0\.0\.0|\[::\]|\[\*\]|\+|\*)(?::(\d+))?(\/.*)?$/i,
		(_, scheme, port, rest) => `${scheme}localhost${port ? `:${port}` : ''}${rest || ''}`
	);

	try
	{
		const parsed = new URL(url);
		return parsed.toString().replace(/\/$/, '');
	}
	catch
	{
		return null;
	}
}

/**
 * Splits semicolon/comma/whitespace-separated URL strings into normalized unique URLs.
 * @param {string} rawValue
 * @returns {string[]}
 */
function splitApplicationUrls(rawValue)
{
	if(!rawValue || typeof rawValue !== 'string')
	{
		return [];
	}

	const parts = rawValue.split(/[;\s,]+/);
	const seen = new Set();
	const result = [];
	for(const part of parts)
	{
		const normalized = normalizeLaunchUrl(part);
		if(normalized && !seen.has(normalized))
		{
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

/**
 * Extracts Kestrel / ASP.NET Core listening URLs from stdout/debug output text.
 * @param {string} text
 * @returns {string[]}
 */
function extractListeningUrlsFromOutput(text)
{
	const clean = stripAnsi(text);
	if(!clean)
	{
		return [];
	}

	const seen = new Set();
	const result = [];
	const regex = /(?:Now listening on|Listening on):\s*(https?:\/\/[^\s"'<>]+)/gi;

	let match;
	while((match = regex.exec(clean)) !== null)
	{
		const normalized = normalizeLaunchUrl(match[1]);
		if(normalized && !seen.has(normalized))
		{
			seen.add(normalized);
			result.push(normalized);
		}
	}

	return result;
}

/**
 * Tokenizes a CLI command string respecting single and double quotes.
 * @param {string} commandLine
 * @returns {string[]}
 */
function tokenizeCommandLine(commandLine)
{
	if(!commandLine || typeof commandLine !== 'string')
	{
		return [];
	}

	const tokens = [];
	let current = '';
	let quote = null;

	for(let i = 0; i < commandLine.length; i++)
	{
		const ch = commandLine[i];
		if(quote)
		{
			if(ch === quote)
			{
				quote = null;
			}
			else if(ch === '\\' && quote === '"' && i + 1 < commandLine.length && commandLine[i + 1] === '"')
			{
				current += '"';
				i++;
			}
			else
			{
				current += ch;
			}
		}
		else if(ch === '"' || ch === '\'')
		{
			quote = ch;
		}
		else if(/\s/.test(ch))
		{
			if(current.length > 0)
			{
				tokens.push(current);
				current = '';
			}
		}
		else
		{
			current += ch;
		}
	}

	if(current.length > 0)
	{
		tokens.push(current);
	}

	return tokens;
}

/**
 * Detects whether a command line invokes `dotnet watch`.
 * @param {string} commandLine
 * @returns {boolean}
 */
function isDotnetWatchCommand(commandLine)
{
	if(!commandLine || typeof commandLine !== 'string')
	{
		return false;
	}

	const segments = commandLine.split(/(?:&&|\|\||;|\|)/);
	for(const segment of segments)
	{
		const tokens = tokenizeCommandLine(segment.trim());
		if(tokens.length < 2)
		{
			continue;
		}

		let idx = 0;
		while(idx < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx]) || tokens[idx] === '&' || tokens[idx] === 'exec'))
		{
			idx++;
		}

		if(idx + 1 >= tokens.length)
		{
			continue;
		}

		const exe = tokens[idx].replace(/\\/g, '/').split('/').pop().toLowerCase();
		if(exe === 'dotnet' || exe === 'dotnet.exe')
		{
			for(let j = idx + 1; j < tokens.length; j++)
			{
				const t = tokens[j];
				if(t === '--')
				{
					break;
				}
				if(t.startsWith('-'))
				{
					continue;
				}
				if(t.toLowerCase() === 'watch')
				{
					return true;
				}
				break;
			}
		}
	}

	return false;
}

/**
 * Extracts --launch-profile, --urls, and --project hints from a command line or args array.
 * @param {string | string[]} commandOrArgs
 * @returns {{ profileName: string | null, urls: string[], projectHint: string | null }}
 */
function extractHintsFromArgs(commandOrArgs)
{
	const tokens = Array.isArray(commandOrArgs)
		? commandOrArgs.map(String)
		: tokenizeCommandLine(commandOrArgs || '');

	let profileName = null;
	let projectHint = null;
	const urls = [];

	for(let i = 0; i < tokens.length; i++)
	{
		const tok = tokens[i];
		const lower = tok.toLowerCase();

		if((lower === '--launch-profile' || lower === '-lp') && i + 1 < tokens.length)
		{
			profileName = tokens[++i];
		}
		else if(lower.startsWith('--launch-profile='))
		{
			profileName = tok.slice('--launch-profile='.length);
		}
		else if(lower.startsWith('-lp='))
		{
			profileName = tok.slice('-lp='.length);
		}
		else if(lower === '--urls' && i + 1 < tokens.length)
		{
			urls.push(...splitApplicationUrls(tokens[++i]));
		}
		else if(lower.startsWith('--urls='))
		{
			urls.push(...splitApplicationUrls(tok.slice('--urls='.length)));
		}
		else if((lower === '--project' || lower === '-p') && i + 1 < tokens.length)
		{
			projectHint = tokens[++i];
		}
		else if(lower.startsWith('--project='))
		{
			projectHint = tok.slice('--project='.length);
		}
		else if(/\.(?:cs|fs)proj$/i.test(tok) && !projectHint)
		{
			projectHint = tok;
		}
	}

	return {
		profileName: profileName || null,
		urls: Array.from(new Set(urls)),
		projectHint: projectHint || null
	};
}

/**
 * Resolves URLs from a parsed launchSettings.json object.
 * @param {any} launchSettings
 * @param {string | null} [profileName]
 * @returns {{ urls: string[], profileName: string | null }}
 */
function resolveUrlsFromLaunchSettings(launchSettings, profileName = null)
{
	if(!launchSettings || typeof launchSettings !== 'object' || !launchSettings.profiles || typeof launchSettings.profiles !== 'object')
	{
		return { urls: [], profileName: null };
	}

	const entries = Object.entries(launchSettings.profiles).filter(([, v]) => v && typeof v === 'object');
	if(entries.length === 0)
	{
		return { urls: [], profileName: null };
	}

	let selectedEntry = null;
	if(profileName)
	{
		selectedEntry = entries.find(([name]) => name === profileName)
			|| entries.find(([name]) => name.toLowerCase() === profileName.toLowerCase())
			|| null;
	}

	if(!selectedEntry)
	{
		selectedEntry = entries.find(([, p]) => String(p.commandName || '').toLowerCase() === 'project' && p.applicationUrl)
			|| entries.find(([, p]) => Boolean(p.applicationUrl))
			|| entries.find(([, p]) => Boolean(p.environmentVariables && p.environmentVariables.ASPNETCORE_URLS))
			|| null;
	}

	if(!selectedEntry)
	{
		return { urls: [], profileName: null };
	}

	const [matchedName, profile] = selectedEntry;
	const urls = [];
	if(typeof profile.applicationUrl === 'string')
	{
		urls.push(...splitApplicationUrls(profile.applicationUrl));
	}
	if(profile.environmentVariables && typeof profile.environmentVariables.ASPNETCORE_URLS === 'string')
	{
		urls.push(...splitApplicationUrls(profile.environmentVariables.ASPNETCORE_URLS));
	}

	return {
		urls: Array.from(new Set(urls)),
		profileName: matchedName
	};
}

/**
 * Resolves URLs from an appsettings.json object (Urls or Kestrel.Endpoints.*.Url).
 * @param {any} appSettings
 * @returns {string[]}
 */
function resolveUrlsFromAppSettings(appSettings)
{
	if(!appSettings || typeof appSettings !== 'object')
	{
		return [];
	}

	const urls = [];
	const directUrls = appSettings.Urls || appSettings.urls;
	if(typeof directUrls === 'string')
	{
		urls.push(...splitApplicationUrls(directUrls));
	}

	const kestrel = appSettings.Kestrel || appSettings.kestrel;
	const endpoints = kestrel && (kestrel.Endpoints || kestrel.EndPoints || kestrel.endpoints);
	if(endpoints && typeof endpoints === 'object')
	{
		for(const ep of Object.values(endpoints))
		{
			if(ep && typeof ep === 'object')
			{
				const epUrl = ep.Url || ep.url;
				if(typeof epUrl === 'string')
				{
					urls.push(...splitApplicationUrls(epUrl));
				}
			}
		}
	}

	return Array.from(new Set(urls));
}

/**
 * Picks the preferred URL from a list based on HTTPS preference.
 * @param {string[]} urls
 * @param {boolean} [preferHttps=true]
 * @returns {string | null}
 */
function pickPreferredUrl(urls, preferHttps = true)
{
	if(!Array.isArray(urls) || urls.length === 0)
	{
		return null;
	}

	const targetScheme = preferHttps ? 'https://' : 'http://';
	const match = urls.find((u) => u.toLowerCase().startsWith(targetScheme));
	return match || urls[0];
}

/**
 * Extracts a .csproj/.fsproj or launched .dll/.exe path from `dotnet watch` output lines.
 * @param {string} text
 * @returns {string | null}
 */
function extractProjectHintFromWatchOutput(text)
{
	const clean = stripAnsi(text);
	if(!clean)
	{
		return null;
	}

	const match = /(?:Building|Launched)\s+([^\r\n]+?\.(?:cs|fs)proj|[^\r\n]+?\.(?:dll|exe))\b/i.exec(clean);
	if(match && match[1])
	{
		const candidate = match[1].trim().replace(/^["']|["']$/g, '');
		if(!/[\\/](?:dotnet-watch|msbuild|vbcscompiler|csc)\.dll$/i.test(candidate))
		{
			return candidate;
		}
	}

	return null;
}

/**
 * Checks whether a VS Code debug configuration type is a C# / .NET debugger.
 * @param {string} type
 * @returns {boolean}
 */
function isCSharpDebugType(type)
{
	if(!type || typeof type !== 'string')
	{
		return false;
	}
	const lower = type.toLowerCase();
	return lower === 'coreclr' || lower === 'dotnet' || lower === 'clr';
}

module.exports = {
	stripAnsi,
	stripJsonComments,
	parseJsonc,
	normalizeLaunchUrl,
	splitApplicationUrls,
	extractListeningUrlsFromOutput,
	extractProjectHintFromWatchOutput,
	tokenizeCommandLine,
	isDotnetWatchCommand,
	extractHintsFromArgs,
	resolveUrlsFromLaunchSettings,
	resolveUrlsFromAppSettings,
	pickPreferredUrl,
	isCSharpDebugType
};
