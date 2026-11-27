'use strict';

const { EventEmitter } = require('events');
const path = require('path');

class SessionManager extends EventEmitter
{
	constructor()
	{
		super();
		/** @type {Map<string, any>} */
		this._sessions = new Map();
	}

	/**
	 * Adds or updates an active session.
	 * @param {string} id
	 * @param {{
	 *   kind: 'debug' | 'watch',
	 *   source: 'debug' | 'shell' | 'task' | 'process',
	 *   label?: string,
	 *   projectDir?: string | null,
	 *   pid?: number | null,
	 *   configUrls?: string[],
	 *   runtimeUrls?: string[],
	 *   urlSource?: string | null
	 * }} data
	 */
	upsertSession(id, data)
	{
		const existing = this._sessions.get(id) || {};
		const next = {
			id,
			kind: data.kind || existing.kind || 'watch',
			source: data.source || existing.source || 'shell',
			label: data.label || existing.label || (data.projectDir ? path.basename(data.projectDir) : '.NET App'),
			projectDir: data.projectDir !== undefined ? data.projectDir : (existing.projectDir || null),
			pid: data.pid !== undefined ? data.pid : (existing.pid || null),
			configUrls: Array.isArray(data.configUrls) ? data.configUrls : (existing.configUrls || []),
			runtimeUrls: Array.isArray(data.runtimeUrls) ? data.runtimeUrls : (existing.runtimeUrls || []),
			urlSource: data.urlSource !== undefined ? data.urlSource : (existing.urlSource || null),
			startedAt: existing.startedAt || Date.now()
		};

		this._sessions.set(id, next);
		this.emit('change');
		return next;
	}

	/**
	 * Merges newly observed runtime listening URLs into a session.
	 * On `dotnet watch` hot-reload restarts, replaces runtimeUrls when a fresh listening batch arrives
	 * if `replace` is true, or accumulates schemes cleanly.
	 * @param {string} id
	 * @param {string[]} urls
	 * @param {boolean} [replace=false]
	 */
	addRuntimeUrls(id, urls, replace = false)
	{
		const existing = this._sessions.get(id);
		if(!existing || !Array.isArray(urls) || urls.length === 0)
		{
			return;
		}

		const merged = replace ? [] : [...existing.runtimeUrls];
		for(const u of urls)
		{
			if(!merged.includes(u))
			{
				merged.push(u);
			}
		}

		const changed = merged.length !== existing.runtimeUrls.length
			|| merged.some((u, idx) => u !== existing.runtimeUrls[idx]);

		if(changed)
		{
			existing.runtimeUrls = merged;
			existing.urlSource = 'runtime-output';
			this.emit('change');
		}
	}

	/**
	 * Updates configUrls on an existing session.
	 * @param {string} id
	 * @param {string[]} urls
	 * @param {string | null} [urlSource]
	 */
	setConfigUrls(id, urls, urlSource = null)
	{
		const existing = this._sessions.get(id);
		if(!existing)
		{
			return;
		}
		const nextUrls = Array.isArray(urls) ? urls : [];
		const changed = nextUrls.length !== existing.configUrls.length
			|| nextUrls.some((u, idx) => u !== existing.configUrls[idx]);
		if(changed)
		{
			existing.configUrls = nextUrls;
			if(existing.runtimeUrls.length === 0 && urlSource)
			{
				existing.urlSource = urlSource;
			}
			this.emit('change');
		}
	}

	/**
	 * Removes a session by ID.
	 * @param {string} id
	 * @returns {boolean}
	 */
	removeSession(id)
	{
		const deleted = this._sessions.delete(id);
		if(deleted)
		{
			this.emit('change');
		}
		return deleted;
	}

	/**
	 * Removes all sessions matching a predicate.
	 * @param {(session: any) => boolean} predicate
	 */
	removeWhere(predicate)
	{
		let removed = false;
		for(const [id, session] of this._sessions.entries())
		{
			if(predicate(session))
			{
				this._sessions.delete(id);
				removed = true;
			}
		}
		if(removed)
		{
			this.emit('change');
		}
	}

	/**
	 * Finds a non-process-polled watch/debug session matching the given projectDir, PID, or parent PID.
	 * @param {string | null} projectDir
	 * @param {number | null} pid
	 * @param {number | null} [parentPid=null]
	 * @returns {any | null}
	 */
	findPrimarySessionFor(projectDir, pid, parentPid = null)
	{
		for(const s of this._sessions.values())
		{
			if(s.source === 'process')
			{
				continue;
			}
			if(pid && s.pid && s.pid === pid)
			{
				return s;
			}
			if(parentPid && s.pid && s.pid === parentPid)
			{
				return s;
			}
			if(projectDir && s.projectDir && path.normalize(s.projectDir).toLowerCase() === path.normalize(projectDir).toLowerCase())
			{
				return s;
			}
		}
		return null;
	}

	/**
	 * Returns true if a non-process-polled watch/debug session already covers the given projectDir or PID.
	 * @param {string | null} projectDir
	 * @param {number | null} pid
	 * @param {number | null} [parentPid=null]
	 * @returns {boolean}
	 */
	hasPrimarySessionFor(projectDir, pid, parentPid = null)
	{
		return Boolean(this.findPrimarySessionFor(projectDir, pid, parentPid));
	}

	/**
	 * Returns all active sessions with their effective URLs.
	 * @returns {Array<any>}
	 */
	getActiveSessions()
	{
		return Array.from(this._sessions.values()).map((s) =>
		{
			const effectiveUrls = s.runtimeUrls.length > 0 ? s.runtimeUrls : s.configUrls;
			return {
				...s,
				urls: effectiveUrls
			};
		});
	}

	/**
	 * Returns only active sessions that have at least one discovered URL.
	 * @returns {Array<any>}
	 */
	getSessionsWithUrls()
	{
		return this.getActiveSessions().filter((s) => s.urls.length > 0);
	}
}

module.exports = { SessionManager };
