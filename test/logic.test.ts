import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, splitMessage, stripPreamble, sanitizeUsername, hasTranslatableText, createRateLimiter } from '../src/logic.ts';

// --- route ------------------------------------------------------------------

const cfg = { sourceChannel: 'SRC', destChannel: 'DST', model: 'gpt-6-luna', enabled: true };
const msg = (channelId: string, content = 'moi', authorIsBot = false, hasAttachments = false) => ({
  authorIsBot,
  channelId,
  content,
  hasAttachments,
});

test('source → dest, translated', () => {
  assert.deepEqual(route(msg('SRC'), cfg), { to: 'DST', translate: true });
});

test('dest → source, forwarded as-is', () => {
  assert.deepEqual(route(msg('DST', 'hello'), cfg), { to: 'SRC', translate: false });
});

test('ignores bots and webhooks in either channel (no loop)', () => {
  assert.equal(route(msg('SRC', 'moi', true), cfg), null);
  assert.equal(route(msg('DST', 'hello', true), cfg), null);
});

test('ignores other channels and empty messages', () => {
  assert.equal(route(msg('OTHER'), cfg), null);
  assert.equal(route(msg('SRC', '   \n '), cfg), null);
});

test('routes attachment-only messages', () => {
  assert.deepEqual(route(msg('SRC', '', false, true), cfg), { to: 'DST', translate: true });
  assert.deepEqual(route(msg('DST', '', false, true), cfg), { to: 'SRC', translate: false });
});

test('ignores everything when disabled or a channel is unset', () => {
  assert.equal(route(msg('SRC'), { ...cfg, enabled: false }), null);
  assert.equal(route(msg('DST'), { ...cfg, enabled: false }), null);
  assert.equal(route(msg('SRC'), { ...cfg, destChannel: null }), null);
  assert.equal(route(msg('DST'), { ...cfg, sourceChannel: null }), null);
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

test('truncates usernames without splitting an emoji or leaving trailing spaces', () => {
  assert.equal(sanitizeUsername('a'.repeat(79) + '😀b'), 'a'.repeat(79) + '😀');
  assert.equal(sanitizeUsername('Matti' + ' '.repeat(80) + 'x'), 'Matti');
});
