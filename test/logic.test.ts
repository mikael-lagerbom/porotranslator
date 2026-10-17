import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkip, splitMessage, stripPreamble, sanitizeUsername, hasTranslatableText, createRateLimiter } from '../src/logic.ts';

// --- shouldSkip -------------------------------------------------------------

const cfg = { sourceChannel: 'SRC', destChannel: 'DST', model: 'gpt-6-luna', enabled: true };

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

test('keeps a label or quotes the user wrote themselves', () => {
  assert.equal(stripPreamble('Translation: wrong card name', 'Käännös: väärä kortin nimi'), 'Translation: wrong card name');
  assert.equal(stripPreamble('"gg"', '"gg"'), '"gg"');
});

// --- sanitizeUsername -------------------------------------------------------

test('passes a normal display name through', () => {
  assert.equal(sanitizeUsername('Matti'), 'Matti');
});

test('truncates usernames longer than 80 chars', () => {
  assert.equal(sanitizeUsername('a'.repeat(100)).length, 80);
});

test('removes Discord-reserved substrings, including ones that re-form', () => {
  assert.equal(sanitizeUsername('discordMatti'), 'Matti');
  assert.equal(sanitizeUsername('disDISCORDcord Matti'), 'Matti');
});

test('falls back when nothing usable remains', () => {
  assert.equal(sanitizeUsername('   '), 'porotranslator');
  assert.equal(sanitizeUsername('clyde'), 'porotranslator');
});

test('never emits a whitespace-only chunk', () => {
  const chunks = splitMessage('a'.repeat(2000) + '\n\n\n' + 'b'.repeat(2000), 2000);
  assert.ok(chunks.every((c) => c.trim().length > 0 && c.length <= 2000));
  assert.equal(chunks.join('').replace(/\n/g, ''), 'a'.repeat(2000) + 'b'.repeat(2000));
});

test('splits on a space when there is no newline', () => {
  const chunks = splitMessage('word '.repeat(500), 2000);
  assert.ok(chunks.every((c) => c.length <= 2000 && !c.startsWith(' ')));
  assert.ok(chunks[0].endsWith('word'));
});

test('does not cut an emoji in half on a hard split', () => {
  const chunks = splitMessage('a'.repeat(1999) + '😀' + 'b', 2000);
  assert.equal(chunks[0], 'a'.repeat(1999));
  assert.ok(chunks[1].startsWith('😀'));
});

// --- hasTranslatableText ----------------------------------------------------

test('detects real text', () => {
  assert.equal(hasTranslatableText('moi kaikki'), true);
  assert.equal(hasTranslatableText('<@123> mikä deck?'), true);
});

test('ignores messages with only mentions, emoji, timestamps and links', () => {
  assert.equal(hasTranslatableText('<@123> <@&45> <#67> <:poro:89> <a:dance:10>'), false);
  assert.equal(hasTranslatableText('https://example.com/cards/deflect <t:1700000000:R>'), false);
  assert.equal(hasTranslatableText('😀 !!'), false);
});

// --- createRateLimiter ------------------------------------------------------

test('rate limiter allows max calls per window, per key, then resets', () => {
  const allow = createRateLimiter(2, 1000);
  assert.deepEqual([allow('a', 0), allow('a', 1), allow('a', 2)], [true, true, false]);
  assert.equal(allow('b', 2), true); // other users unaffected
  assert.equal(allow('a', 1000), true); // new window
});

test('still strips the preamble when the source merely starts with a label', () => {
  assert.equal(stripPreamble('Translation: Note: the card is banned', 'Huom: kortti on kielletty'), 'Note: the card is banned');
});
