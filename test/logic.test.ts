import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkip, splitMessage, stripPreamble, sanitizeUsername } from '../src/logic.ts';

// --- shouldSkip -------------------------------------------------------------

const cfg = { sourceChannel: 'SRC', destChannel: 'DST', model: 'gpt-4.1-nano', enabled: true };

test('skips messages from bots', () => {
  assert.equal(shouldSkip({ authorIsBot: true, channelId: 'SRC', content: 'moi' }, cfg), true);
});

test('skips messages not in the source channel', () => {
  assert.equal(shouldSkip({ authorIsBot: false, channelId: 'OTHER', content: 'moi' }, cfg), true);
});

test('skips empty / whitespace-only messages', () => {
  assert.equal(shouldSkip({ authorIsBot: false, channelId: 'SRC', content: '   \n ' }, cfg), true);
});

test('skips when translation disabled', () => {
  assert.equal(shouldSkip({ authorIsBot: false, channelId: 'SRC', content: 'moi' }, { ...cfg, enabled: false }), true);
});

test('skips when source channel unset', () => {
  assert.equal(shouldSkip({ authorIsBot: false, channelId: 'SRC', content: 'moi' }, { ...cfg, sourceChannel: null }), true);
});

test('skips when dest channel unset (nowhere to post)', () => {
  assert.equal(shouldSkip({ authorIsBot: false, channelId: 'SRC', content: 'moi' }, { ...cfg, destChannel: null }), true);
});

test('does not skip a real message in the source channel', () => {
  assert.equal(shouldSkip({ authorIsBot: false, channelId: 'SRC', content: 'moi' }, cfg), false);
});

// --- splitMessage -----------------------------------------------------------

test('returns single chunk when under the limit', () => {
  assert.deepEqual(splitMessage('hello', 2000), ['hello']);
});

test('splits text longer than the limit into multiple chunks', () => {
  const chunks = splitMessage('a'.repeat(4500), 2000);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 2000));
  assert.equal(chunks.join(''), 'a'.repeat(4500));
});

test('prefers splitting on a newline boundary', () => {
  const text = 'x'.repeat(1990) + '\n' + 'y'.repeat(100);
  const chunks = splitMessage(text, 2000);
  assert.equal(chunks[0], 'x'.repeat(1990));
  assert.equal(chunks[1], 'y'.repeat(100));
});

// --- stripPreamble ----------------------------------------------------------

test('leaves clean translations untouched', () => {
  assert.equal(stripPreamble('The meeting is at three.'), 'The meeting is at three.');
});

test('strips a leading "Translation:" label', () => {
  assert.equal(stripPreamble('Translation: The meeting is at three.'), 'The meeting is at three.');
});

test('strips surrounding quotes', () => {
  assert.equal(stripPreamble('"The meeting is at three."'), 'The meeting is at three.');
});

test('strips "Here is the translation:" preamble', () => {
  assert.equal(stripPreamble('Here is the translation: hello'), 'hello');
});

test('keeps quotes when the text contains inner quotes (real dialogue)', () => {
  const dialogue = '"Hello," she said, "come here."';
  assert.equal(stripPreamble(dialogue), dialogue);
});

test('only strips a pure wrapping quote pair', () => {
  assert.equal(stripPreamble('"just a wrapper"'), 'just a wrapper');
});

// --- sanitizeUsername -------------------------------------------------------

test('passes a normal display name through', () => {
  assert.equal(sanitizeUsername('Matti', 'fallback'), 'Matti');
});

test('truncates usernames longer than 80 chars', () => {
  assert.equal(sanitizeUsername('a'.repeat(100), 'fallback').length, 80);
});

test('removes Discord-reserved substrings', () => {
  assert.ok(!/discord/i.test(sanitizeUsername('discordMatti', 'fb')));
  assert.ok(!/clyde/i.test(sanitizeUsername('clyde', 'fb') || ''));
});

test('falls back when nothing usable remains', () => {
  assert.equal(sanitizeUsername('   ', 'fallback'), 'fallback');
  assert.equal(sanitizeUsername('clyde', 'fallback'), 'fallback');
});
