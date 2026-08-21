const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
const { parseModelJson } = require('./gemini');

test('parses clean JSON untouched', () => {
  const out = parseModelJson('{"caption":"hello","n":2}');
  assert.equal(out.caption, 'hello');
});

test('does not corrupt curly quotes inside a string value', () => {
  // The regression: the old code straightened curly quotes BEFORE parsing,
  // which ended the string early and threw on otherwise valid JSON.
  const original = 'He called it “the truth” and moved on.';
  const out = parseModelJson(JSON.stringify({ body: original }));
  assert.equal(out.body, original);
});

test('repairs curly quotes only when they actually break the JSON', () => {
  // Curly quotes used as delimiters -- invalid until straightened.
  const out = parseModelJson('{"body": “plain text”}');
  assert.equal(out.body, 'plain text');
});

test('repairs raw control characters inside a string value', () => {
  const broken = '{"body":"line one' + String.fromCharCode(1) + ' still going"}';
  const out = parseModelJson(broken);
  assert.equal(out.body, 'line one still going');
});

test('keeps newlines and tabs when stripping control characters', () => {
  const broken = '{"body":"a' + String.fromCharCode(7) + 'b"}';
  assert.equal(parseModelJson(broken).body, 'ab');
});

test('throws a clear error when nothing can rescue it', () => {
  assert.throws(() => parseModelJson('{"body": '), /unparseable JSON/);
});
