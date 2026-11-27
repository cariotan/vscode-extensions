'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	stripAnsi,
	stripJsonComments,
	parseJsonc,
	normalizeLaunchUrl,
	splitApplicationUrls,
	extractListeningUrlsFromOutput,
	extractProjectHintFromWatchOutput,
	isDotnetWatchCommand,
	extractHintsFromArgs,
	resolveUrlsFromLaunchSettings,
	resolveUrlsFromAppSettings,
	pickPreferredUrl,
	isCSharpDebugType
} = require('../lib/urlParser');

test('stripAnsi removes terminal color codes', () =>
{
	const raw = '\x1b[40m\x1b[32minfo\x1b[39m\x1b[22m\x1b[49m: Microsoft.Hosting.Lifetime[14]\n      Now listening on: \x1b[36mhttps://localhost:7123\x1b[39m';
	const clean = stripAnsi(raw);
	assert.ok(clean.includes('Now listening on: https://localhost:7123'));
});

test('stripJsonComments preserves https:// inside strings while stripping comments and trailing commas', () =>
{
	const jsonc = `{
		// Top-level comment
		"profiles": {
			"https": {
				"commandName": "Project", /* inline comment */
				"applicationUrl": "https://localhost:7123;http://localhost:5123",
			},
		}
	}`;
	const parsed = parseJsonc(jsonc);
	assert.equal(parsed.profiles.https.applicationUrl, 'https://localhost:7123;http://localhost:5123');
});

test('normalizeLaunchUrl converts wildcard hosts to localhost', () =>
{
	assert.equal(normalizeLaunchUrl('http://0.0.0.0:5000'), 'http://localhost:5000');
	assert.equal(normalizeLaunchUrl('https://[::]:7001/'), 'https://localhost:7001');
	assert.equal(normalizeLaunchUrl('http://+:8080'), 'http://localhost:8080');
	assert.equal(normalizeLaunchUrl('http://*:5123'), 'http://localhost:5123');
	assert.equal(normalizeLaunchUrl('https://localhost:7123/swagger'), 'https://localhost:7123/swagger');
	assert.equal(normalizeLaunchUrl('not-a-url'), null);
});

test('splitApplicationUrls splits semicolon-separated URLs and deduplicates', () =>
{
	assert.deepEqual(
		splitApplicationUrls('https://localhost:7123; http://localhost:5123;https://localhost:7123'),
		['https://localhost:7123', 'http://localhost:5123']
	);
});

test('extractListeningUrlsFromOutput extracts Kestrel listening URLs from ANSI output', () =>
{
	const output = [
		'\x1b[32minfo\x1b[0m: Microsoft.Hosting.Lifetime[14]',
		'      Now listening on: https://localhost:7240',
		'      Now listening on: http://[::]:5180',
		'      Application started. Press Ctrl+C to shut down.'
	].join('\n');

	assert.deepEqual(
		extractListeningUrlsFromOutput(output),
		['https://localhost:7240', 'http://localhost:5180']
	);
});

test('isDotnetWatchCommand recognizes dotnet watch variants and rejects non-watch commands', () =>
{
	assert.equal(isDotnetWatchCommand('dotnet watch'), true);
	assert.equal(isDotnetWatchCommand('dotnet watch run --launch-profile https'), true);
	assert.equal(isDotnetWatchCommand('"C:\\Program Files\\dotnet\\dotnet.exe" watch --project ./WebApp'), true);
	assert.equal(isDotnetWatchCommand('ASPNETCORE_ENVIRONMENT=Development dotnet watch'), true);
	assert.equal(isDotnetWatchCommand('cd src && dotnet watch run'), true);
	assert.equal(isDotnetWatchCommand('dotnet build'), false);
	assert.equal(isDotnetWatchCommand('dotnet run'), false);
	assert.equal(isDotnetWatchCommand('echo dotnet watch'), false);
});

test('extractHintsFromArgs extracts launch profile, urls, and project', () =>
{
	const hints = extractHintsFromArgs('dotnet watch run --launch-profile "https" --urls=https://localhost:9001;http://localhost:9000 --project ./Api/Api.csproj');
	assert.equal(hints.profileName, 'https');
	assert.deepEqual(hints.urls, ['https://localhost:9001', 'http://localhost:9000']);
	assert.equal(hints.projectHint, './Api/Api.csproj');
});

test('resolveUrlsFromLaunchSettings picks matching profile or falls back to Project profile', () =>
{
	const ls = {
		profiles: {
			IISExpress: {
				commandName: 'IISExpress',
				launchBrowser: true
			},
			http: {
				commandName: 'Project',
				applicationUrl: 'http://localhost:5042'
			},
			https: {
				commandName: 'Project',
				applicationUrl: 'https://localhost:7042;http://localhost:5042'
			}
		}
	};

	assert.deepEqual(resolveUrlsFromLaunchSettings(ls, 'https'), {
		urls: ['https://localhost:7042', 'http://localhost:5042'],
		profileName: 'https'
	});

	assert.deepEqual(resolveUrlsFromLaunchSettings(ls, null), {
		urls: ['http://localhost:5042'],
		profileName: 'http'
	});
});

test('resolveUrlsFromAppSettings extracts Urls and Kestrel endpoints', () =>
{
	const appSettings = {
		Urls: 'http://localhost:5050',
		Kestrel: {
			Endpoints: {
				Https: { Url: 'https://localhost:7050' }
			}
		}
	};
	assert.deepEqual(resolveUrlsFromAppSettings(appSettings), [
		'http://localhost:5050',
		'https://localhost:7050'
	]);
});

test('pickPreferredUrl respects preferHttps flag', () =>
{
	const urls = ['http://localhost:5000', 'https://localhost:5001'];
	assert.equal(pickPreferredUrl(urls, true), 'https://localhost:5001');
	assert.equal(pickPreferredUrl(urls, false), 'http://localhost:5000');
});

test('isCSharpDebugType matches coreclr and dotnet', () =>
{
	assert.equal(isCSharpDebugType('coreclr'), true);
	assert.equal(isCSharpDebugType('dotnet'), true);
	assert.equal(isCSharpDebugType('node'), false);
});

test('extractProjectHintFromWatchOutput extracts Building .csproj and Launched .dll paths', () =>
{
	assert.equal(
		extractProjectHintFromWatchOutput('dotnet watch 🔧 Building C:\\Dev\\MyApp\\MyApp.csproj ...'),
		'C:\\Dev\\MyApp\\MyApp.csproj'
	);
	assert.equal(
		extractProjectHintFromWatchOutput('dotnet watch 🚀 Launched C:\\Dev\\MyApp\\bin\\Debug\\net10.0\\MyApp.dll'),
		'C:\\Dev\\MyApp\\bin\\Debug\\net10.0\\MyApp.dll'
	);
	assert.equal(extractProjectHintFromWatchOutput('dotnet watch 🔥 Hot reload enabled.'), null);
});
