'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	resolveProjectDir,
	readLaunchConfigUrls
} = require('../lib/projectDiscovery');
const { SessionManager } = require('../lib/sessionManager');

test('resolveProjectDir walks up from bin/Debug/net8.0/App.dll to project root', () =>
{
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-app-url-test-'));
	try
	{
		const projDir = path.join(tmpRoot, 'MyWebApp');
		const binDir = path.join(projDir, 'bin', 'Debug', 'net8.0');
		const propsDir = path.join(projDir, 'Properties');
		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(propsDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, 'MyWebApp.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
		fs.writeFileSync(
			path.join(propsDir, 'launchSettings.json'),
			JSON.stringify({
				profiles: {
					https: {
						commandName: 'Project',
						applicationUrl: 'https://localhost:7111;http://localhost:5111'
					}
				}
			})
		);

		const resolved = resolveProjectDir({
			cwd: projDir,
			program: path.join(binDir, 'MyWebApp.dll')
		});
		assert.equal(resolved, projDir);

		const config = readLaunchConfigUrls(resolved, { profileName: 'https' });
		assert.equal(config.projectName, 'MyWebApp');
		assert.equal(config.source, 'launchSettings.json');
		assert.deepEqual(config.urls, ['https://localhost:7111', 'http://localhost:5111']);
	}
	finally
	{
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
});

test('readLaunchConfigUrls prioritizes CLI --urls and ASPNETCORE_URLS over launchSettings.json', () =>
{
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-app-url-test2-'));
	try
	{
		const propsDir = path.join(tmpRoot, 'Properties');
		fs.mkdirSync(propsDir, { recursive: true });
		fs.writeFileSync(path.join(tmpRoot, 'Demo.csproj'), '<Project />');
		fs.writeFileSync(
			path.join(propsDir, 'launchSettings.json'),
			JSON.stringify({
				profiles: {
					http: {
						commandName: 'Project',
						applicationUrl: 'http://localhost:5000'
					}
				}
			})
		);

		const fromEnv = readLaunchConfigUrls(tmpRoot, { envUrls: 'https://localhost:6001' });
		assert.deepEqual(fromEnv.urls, ['https://localhost:6001']);
		assert.equal(fromEnv.source, 'ASPNETCORE_URLS');

		const fromCli = readLaunchConfigUrls(tmpRoot, {
			envUrls: 'https://localhost:6001',
			cliUrls: ['https://localhost:7777']
		});
		assert.deepEqual(fromCli.urls, ['https://localhost:7777']);
		assert.equal(fromCli.source, 'cli-urls');
	}
	finally
	{
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
});

test('SessionManager prioritizes runtimeUrls over configUrls and deduplicates primary sessions', () =>
{
	const mgr = new SessionManager();
	mgr.upsertSession('debug:1', {
		kind: 'debug',
		source: 'debug',
		label: 'WebApi',
		projectDir: 'C:\\Dev\\WebApi',
		configUrls: ['https://localhost:7000']
	});

	assert.equal(mgr.hasPrimarySessionFor('c:\\dev\\webapi', null), true);
	assert.deepEqual(mgr.getSessionsWithUrls()[0].urls, ['https://localhost:7000']);

	mgr.addRuntimeUrls('debug:1', ['https://localhost:7999', 'http://localhost:5999'], false);
	assert.deepEqual(mgr.getSessionsWithUrls()[0].urls, ['https://localhost:7999', 'http://localhost:5999']);
});

test('SessionManager matches primary session by parentPid for dotnet watch shell terminals', () =>
{
	const mgr = new SessionManager();
	mgr.upsertSession('shell:1', {
		kind: 'watch',
		source: 'shell',
		label: 'pwsh',
		projectDir: null,
		pid: 20904,
		configUrls: []
	});

	const matched = mgr.findPrimarySessionFor(null, 18032, 20904);
	assert.ok(matched);
	assert.equal(matched.id, 'shell:1');
	assert.equal(mgr.hasPrimarySessionFor(null, 18032, 20904), true);
});
