// The deck used to be exactly four pages, so a comment like "add two slides" quietly did nothing.
// These cover the extra pages and the page count the emails quote.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FOURUPLE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '4ruple-deck-test-'));
const { deckHtml } = await import('../lib/deck.js');
const { syncPageCount, deckPageCount, MAX_EXTRA_PAGES } = await import('../lib/generate.js');

const lead = { fullName: 'Riya Bheda', firstName: 'Riya', company: 'Tidewater Coffee', domain: 'tidewater.example' };
const profile = { companyName: 'Northlight Studio', senderName: 'Dev Patel', calendly: '' };
const base = {
  cover: { headline: 'After the pop-up', subhead: 'A month of video in one shoot day' },
  problem: { title: 'The quiet weeks', points: ['One', 'Two', 'Three'], insight: 'The queue did the work' },
  solution: { title: 'How we do it', steps: [{ title: 'Shoot', detail: 'One day on site' }], outcome: 'Enough for a month' },
  work: { title: 'Work we have done', items: [{ client: 'Dunkin', what: 'Creator reels', result: '' }], cta: 'Worth 15 minutes?' },
};
const html = (deck) => deckHtml({ lead, profile, content: { deck }, brand: {} });
const pageCount = (markup) => (markup.match(/<section class="page/g) || []).length;

test('a deck is four pages until the sender asks for more', () => {
  const markup = html(base);
  assert.equal(pageCount(markup), 4);
  assert.match(markup, /4 \/ 4/);
  assert.equal(markup.includes('class="page extra"'), false);
});

test('asking for two more slides adds two pages, numbered out of the new total', () => {
  const markup = html({
    ...base,
    extra: [
      { title: 'Timeline', body: 'Two weeks to the first cut.', bullets: ['Week 1 shoot', 'Week 2 edit'] },
      { title: 'What it costs', body: 'One shoot day, one rate.', bullets: [] },
    ],
  });
  assert.equal(pageCount(markup), 6);
  assert.match(markup, /5 \/ 6/);
  assert.match(markup, /6 \/ 6/);
  assert.match(markup, /Timeline/);
  assert.match(markup, /Week 1 shoot/);
  assert.match(markup, /What it costs/);
});

test('extra pages are capped, and each page shows at most three bullets', () => {
  const extra = Array.from({ length: 7 }, (_, i) => ({ title: `Page ${i}`, body: '', bullets: ['a', 'b', 'c', 'd'] }));
  const markup = html({ ...base, extra });
  assert.equal(pageCount(markup), 4 + MAX_EXTRA_PAGES);
  const firstExtra = markup.split('class="page extra"')[1];
  assert.equal((firstExtra.match(/<li>/g) || []).length, 3);
});

test('the emails stop saying 4-page once the deck grows', () => {
  const out = {
    deck: { ...base, extra: [{ title: 'Timeline' }, { title: 'What it costs' }] },
    email1: 'I have attached a 4-page deck made for Tidewater.',
    followup1: 'The 4 page deck has the shoot plan inside it.',
    followup2: 'Nothing about the deck here.',
  };
  assert.equal(syncPageCount(out), 6);
  assert.match(out.email1, /6-page deck/);
  assert.match(out.followup1, /6-page deck/);
  assert.equal(out.followup2, 'Nothing about the deck here.');
  assert.equal(deckPageCount(out.deck), 6);
});

test('a deck with no extra pages is left exactly as it was', () => {
  const out = { deck: { ...base }, email1: 'A 4-page deck is attached.' };
  assert.equal(syncPageCount(out), 4);
  assert.match(out.email1, /4-page deck/);
  assert.deepEqual(out.deck.extra, []);
});

test('rubbish in deck.extra cannot break the page count', () => {
  const out = { deck: { ...base, extra: 'two more slides please' }, email1: 'A 4-page deck is attached.' };
  assert.equal(syncPageCount(out), 4);
  assert.deepEqual(out.deck.extra, []);
  assert.equal(deckPageCount(undefined), 4);
});
