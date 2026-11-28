const test = require('node:test')
const assert = require('node:assert/strict')
const {
	stripAnsi,
	splitTrailingIncompleteEscape,
	createStreamMatcher
} = require('../matcher')

test('matches common exception and error variants case-insensitively', () =>
{
	const samples = [
		'Unhandled Exception: System.NullReferenceException',
		'unhandled exception in worker',
		'TypeError: Cannot read properties of undefined',
		'ReferenceError: foo is not defined',
		'SyntaxError: Unexpected token',
		'ERROR: connection refused',
		'Traceback (most recent call last):',
		'fatal error: something broke',
		'panic: runtime error: index out of range',
		'thread \'main\' panicked at src/main.rs:10',
		'npm ERR! code ELIFECYCLE',
		'Segmentation fault (core dumped)'
	]

	for(const sample of samples)
	{
		const matcher = createStreamMatcher()
		const res = matcher.push(sample)
		assert.equal(res.matched, true, `Expected match for: ${sample}`)
	}
})

test('matches words split across chunk boundaries', () =>
{
	const matcher = createStreamMatcher()
	assert.equal(matcher.push('Something went wrong: Excep').matched, false)
	const second = matcher.push('tion in module')
	assert.equal(second.matched, true)

	const matcher2 = createStreamMatcher()
	assert.equal(matcher2.push('Type').matched, false)
	assert.equal(matcher2.push('Err').matched, false)
	assert.equal(matcher2.push('or: boom').matched, true)
})

test('strips ANSI color and ConPTY cursor codes without breaking words', () =>
{
	const matcher = createStreamMatcher()
	const res = matcher.push('\x1b[31mType\x1b[1mError\x1b[0m: bad input')
	assert.equal(res.matched, true)

	const stripped = stripAnsi('\x1b[31mhello\x1b[1Cworld\x1b[0m')
	assert.equal(stripped, 'hello world')
})

test('handles incomplete ANSI escape sequences split across chunks', () =>
{
	const split = splitTrailingIncompleteEscape('Excep\x1b[')
	assert.equal(split.complete, 'Excep')
	assert.equal(split.pending, '\x1b[')

	const matcher = createStreamMatcher()
	assert.equal(matcher.push('Excep\x1b[').matched, false)
	const second = matcher.push('0mtion thrown')
	assert.equal(second.matched, true)

	const matcher2 = createStreamMatcher()
	assert.equal(matcher2.push('Something \x1b[3').matched, false)
	assert.equal(matcher2.push('1merror\x1b[0m happened').matched, true)
})

test('does not false-trigger on zero-error summaries but still catches real errors', () =>
{
	const matcher = createStreamMatcher()
	assert.equal(matcher.push('Build succeeded. 0 errors, 0 warnings.\n').matched, false)
	assert.equal(matcher.push('Lint complete: no errors found.\n').matched, false)
	assert.equal(matcher.push('Tests complete (Errors: 0, 0 error(s))\n').matched, false)
	assert.equal(matcher.push('Now failing: TypeError: boom\n').matched, true)
})

test('does not re-trigger on subsequent unrelated chunks from tail buffer', () =>
{
	const matcher = createStreamMatcher()
	assert.equal(matcher.push('Error: first failure\n').matched, true)
	assert.equal(matcher.push('normal log line 1\n').matched, false)
	assert.equal(matcher.push('normal log line 2\n').matched, false)
	assert.equal(matcher.push('Another Exception occurred\n').matched, true)
})

test('supports caseSensitive option and survives invalid regex patterns', () =>
{
	const matcher = createStreamMatcher({
		patterns: ['[invalid-regex', 'Exception'],
		caseSensitive: true
	})
	assert.equal(matcher.push('exception in lowercase').matched, false)
	assert.equal(matcher.push('Exception in PascalCase').matched, true)
})
