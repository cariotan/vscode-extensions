const DEFAULT_PATTERNS = [
	'exception',
	'error',
	'traceback',
	'fatal',
	'unhandled',
	'\\bpanic:',
	'panicked at',
	'\\berr!',
	'segmentation fault'
]

const MAX_TAIL_CHARS = 256
const MAX_PENDING_ESCAPE_CHARS = 128

// Matches an incomplete trailing ANSI/VT escape sequence at the end of a chunk:
// - bare ESC
// - incomplete CSI: ESC [ ... (without final byte @-~)
// - incomplete OSC: ESC ] ... (without BEL or ST)
const TRAILING_INCOMPLETE_ESCAPE_RE = /(?:\x1b|\x1b\[[0-?]*[ -/]*|\x1b\][^\x07\x1b\r\n]*)$/

// CSI sequences that move the cursor (ConPTY frequently uses CUF e.g. \x1b[1C instead of spaces)
const CSI_CURSOR_MOVE_RE = /\x1b\[[0-9;]*[ABCDGHf]/g
const CSI_NEWLINE_MOVE_RE = /\x1b\[[0-9;]*[EF]/g

// Complete ANSI/VT escape sequences
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const SINGLE_ESC_RE = /\x1b[@-Z\\-_]/g
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

// Harmless zero-error summary phrases like "0 errors", "no errors", "0 error(s)", "errors: 0"
const ZERO_ERROR_SUMMARY_RE = /\b(?:0|no)\s+errors?(?:\(s\))?\b|\berrors?\s*:\s*0\b/gi

function splitTrailingIncompleteEscape(chunk)
{
	if(!chunk)
	{
		return { complete: '', pending: '' }
	}

	const match = TRAILING_INCOMPLETE_ESCAPE_RE.exec(chunk)
	if(!match || match[0].length > MAX_PENDING_ESCAPE_CHARS)
	{
		return { complete: chunk, pending: '' }
	}

	return {
		complete: chunk.slice(0, match.index),
		pending: match[0]
	}
}

function stripAnsi(text)
{
	if(!text)
	{
		return ''
	}

	return text
		.replace(OSC_RE, '')
		.replace(CSI_NEWLINE_MOVE_RE, '\n')
		.replace(CSI_CURSOR_MOVE_RE, ' ')
		.replace(CSI_RE, '')
		.replace(SINGLE_ESC_RE, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(CONTROL_CHARS_RE, '')
}

function sanitizeZeroErrorSummaries(text)
{
	return text.replace(ZERO_ERROR_SUMMARY_RE, '')
}

function escapeRegExp(literal)
{
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePatterns(patterns = DEFAULT_PATTERNS, caseSensitive = false)
{
	const list = Array.isArray(patterns) && patterns.length > 0 ? patterns : DEFAULT_PATTERNS
	const flags = caseSensitive ? '' : 'i'
	const compiled = []

	for(const rawPattern of list)
	{
		if(typeof rawPattern !== 'string' || rawPattern.length === 0)
		{
			continue
		}

		try
		{
			compiled.push(new RegExp(rawPattern, flags))
		}
		catch
		{
			// Fall back to literal match if a user entered an invalid regex
			compiled.push(new RegExp(escapeRegExp(rawPattern), flags))
		}
	}

	return compiled
}

function createStreamMatcher(options = {})
{
	const compiled = compilePatterns(options.patterns, options.caseSensitive)
	const ignoreZeroErrorSummaries = options.ignoreZeroErrorSummaries !== false
	let pendingEscape = ''
	let textTail = ''

	return {
		push(chunk)
		{
			if(typeof chunk !== 'string' || chunk.length === 0)
			{
				return { matched: false, matchText: null }
			}

			const combinedRaw = pendingEscape + chunk
			const { complete, pending } = splitTrailingIncompleteEscape(combinedRaw)
			pendingEscape = pending

			if(!complete)
			{
				return { matched: false, matchText: null }
			}

			const clean = stripAnsi(complete)
			if(!clean)
			{
				return { matched: false, matchText: null }
			}

			const windowText = textTail + clean
			const searchable = ignoreZeroErrorSummaries
				? sanitizeZeroErrorSummaries(windowText)
				: windowText

			for(const regex of compiled)
			{
				const match = regex.exec(searchable)
				if(match)
				{
					// Advance tail past the match so the next unrelated chunk doesn't re-trigger on the same text
					const afterMatch = searchable.slice(match.index + Math.max(match[0].length, 1))
					textTail = afterMatch.slice(-MAX_TAIL_CHARS)
					return { matched: true, matchText: match[0] }
				}
			}

			textTail = windowText.slice(-MAX_TAIL_CHARS)
			return { matched: false, matchText: null }
		}
	}
}

module.exports = {
	DEFAULT_PATTERNS,
	splitTrailingIncompleteEscape,
	stripAnsi,
	sanitizeZeroErrorSummaries,
	compilePatterns,
	createStreamMatcher
}
