'use strict';

const { execFile } = require('child_process');
const { isDotnetWatchCommand } = require('./urlParser');

/**
 * Lists running `dotnet watch` processes on the local machine.
 * Returns { pid, parentPid, commandLine, listeningPorts }[].
 * Never throws; returns [] on error.
 * @returns {Promise<Array<{ pid: number, parentPid: number, commandLine: string, listeningPorts: number[] }>>}
 */
function findDotnetWatchProcesses()
{
	if(process.platform === 'win32')
	{
		return findWindowsDotnetWatchProcesses();
	}
	return findUnixDotnetWatchProcesses();
}

function findWindowsDotnetWatchProcesses()
{
	return new Promise((resolve) =>
	{
		const psScript = [
			"$ErrorActionPreference = 'SilentlyContinue'",
			"$allProcs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine",
			"if (-not $allProcs) { '[]'; exit 0 }",
			"$watches = @($allProcs | Where-Object { ($_.Name -eq 'dotnet.exe' -or $_.Name -eq 'dotnet') -and $_.CommandLine -match '(?i)\\bwatch\\b' })",
			"if ($watches.Count -eq 0) { '[]'; exit 0 }",
			"$conns = Get-NetTCPConnection -State Listen | Select-Object OwningProcess, LocalPort",
			"$byParent = @{}",
			"foreach ($p in $allProcs) {",
			"  $ppid = [int]$p.ParentProcessId",
			"  if (-not $byParent.ContainsKey($ppid)) { $byParent[$ppid] = [System.Collections.ArrayList]::new() }",
			"  [void]$byParent[$ppid].Add($p)",
			"}",
			"$result = foreach ($w in $watches) {",
			"  $queue = [System.Collections.Queue]::new()",
			"  $visited = [System.Collections.Generic.HashSet[int]]::new()",
			"  [void]$visited.Add([int]$w.ProcessId)",
			"  $queue.Enqueue([int]$w.ProcessId)",
			"  $descendants = [System.Collections.ArrayList]::new()",
			"  while ($queue.Count -gt 0) {",
			"    $curr = $queue.Dequeue()",
			"    if ($byParent.ContainsKey($curr)) {",
			"      foreach ($child in $byParent[$curr]) {",
			"        $cid = [int]$child.ProcessId",
			"        if ($visited.Add($cid)) {",
			"          [void]$descendants.Add($child)",
			"          $queue.Enqueue($cid)",
			"        }",
			"      }",
			"    }",
			"  }",
			"  $appProcs = @($descendants | Where-Object { $_.CommandLine -notmatch '(?i)dotnet-watch\\.dll' -and $_.Name -notmatch '(?i)^(conhost|msbuild|vbcscompiler|csc|git)\\.exe$' })",
			"  $appIds = @($appProcs | Select-Object -ExpandProperty ProcessId)",
			"  $childCmds = @($appProcs | ForEach-Object { if ($_.CommandLine) { $_.CommandLine } elseif ($_.ExecutablePath) { $_.ExecutablePath } } | Where-Object { $_ })",
			"  $childExes = @($appProcs | Select-Object -ExpandProperty ExecutablePath | Where-Object { $_ })",
			"  $ports = if ($appIds.Count -gt 0) { @($conns | Where-Object { $appIds -contains $_.OwningProcess } | Select-Object -ExpandProperty LocalPort -Unique) } else { @() }",
			"  [PSCustomObject]@{ pid = $w.ProcessId; parentPid = $w.ParentProcessId; commandLine = $w.CommandLine; childCommandLines = $childCmds; childExecutablePaths = $childExes; listeningPorts = $ports }",
			"}",
			"@($result) | ConvertTo-Json -Compress -Depth 3"
		].join('; ');

		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
			{ timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
			(err, stdout) =>
			{
				if(err || !stdout)
				{
					resolve([]);
					return;
				}
				try
				{
					const trimmed = stdout.trim();
					if(!trimmed)
					{
						resolve([]);
						return;
					}
					const parsed = JSON.parse(trimmed);
					const arr = Array.isArray(parsed) ? parsed : [parsed];
					const valid = arr
						.filter((item) => item && typeof item.commandLine === 'string' && isDotnetWatchCommand(item.commandLine))
						.map((item) => ({
							pid: Number(item.pid),
							parentPid: Number(item.parentPid),
							commandLine: item.commandLine,
							childCommandLines: toStringArray(item.childCommandLines),
							childExecutablePaths: toStringArray(item.childExecutablePaths),
							listeningPorts: Array.isArray(item.listeningPorts)
								? item.listeningPorts.map(Number).filter((n) => Number.isInteger(n) && n > 0)
								: []
						}));
					resolve(valid);
				}
				catch
				{
					resolve([]);
				}
			}
		);
	});
}

function toStringArray(val)
{
	if(Array.isArray(val))
	{
		return val.filter((c) => typeof c === 'string' && c.length > 0);
	}
	if(typeof val === 'string' && val.length > 0)
	{
		return [val];
	}
	return [];
}

function findUnixDotnetWatchProcesses()
{
	return new Promise((resolve) =>
	{
		execFile(
			'ps',
			['-eo', 'pid=,ppid=,args='],
			{ timeout: 3000, maxBuffer: 1024 * 1024 },
			(err, stdout) =>
			{
				if(err || !stdout)
				{
					resolve([]);
					return;
				}
				const allProcs = [];
				const byParent = new Map();
				const lines = stdout.split(/\r?\n/);
				for(const line of lines)
				{
					const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
					if(!match)
					{
						continue;
					}
					const proc = {
						pid: Number(match[1]),
						parentPid: Number(match[2]),
						commandLine: match[3].trim()
					};
					allProcs.push(proc);
					if(!byParent.has(proc.parentPid))
					{
						byParent.set(proc.parentPid, []);
					}
					byParent.get(proc.parentPid).push(proc);
				}

				const results = [];
				for(const proc of allProcs)
				{
					if(!isDotnetWatchCommand(proc.commandLine))
					{
						continue;
					}
					const queue = [proc.pid];
					const visited = new Set([proc.pid]);
					const childCommandLines = [];
					while(queue.length > 0)
					{
						const curr = queue.shift();
						for(const child of (byParent.get(curr) || []))
						{
							if(!visited.has(child.pid))
							{
								visited.add(child.pid);
								queue.push(child.pid);
								if(!/dotnet-watch\.dll/i.test(child.commandLine))
								{
									childCommandLines.push(child.commandLine);
								}
							}
						}
					}
					results.push({
						pid: proc.pid,
						parentPid: proc.parentPid,
						commandLine: proc.commandLine,
						childCommandLines,
						childExecutablePaths: [],
						listeningPorts: []
					});
				}
				resolve(results);
			}
		);
	});
}

module.exports = {
	findDotnetWatchProcesses
};
