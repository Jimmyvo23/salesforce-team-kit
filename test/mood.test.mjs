import { test, expect } from 'vitest';
import { moodAt, moodFor, blendHex, oklch, PALETTES, MOODS, moodTokens } from '../dashboard/src/mood.ts';

const at = (h, m = 0) => new Date(2026, 9, 20, h, m);

const rgbMix = (a, b, t) => '#' + [1, 3, 5].map((i) => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
  return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
}).join('');

test('MOODS lists the four pinnable moods in picker order', () => {
  expect(MOODS.map((m) => m.label)).toEqual(['Night shift', 'Sunrise', 'Mint morning', 'Twilight']);
});

test.each([
  [3, 'night'], [8, 'sunrise'], [12, 'mint'], [18, 'twilight'], [22, 'night'],
])('at %i:00 the mood is exactly the %s palette', (h, name) => {
  const m = moodAt(at(h));
  expect(m.sky).toEqual(PALETTES[name].sky);
  expect(m.floor).toBe(PALETTES[name].floor);
  expect(m.label).toBe(PALETTES[name].label);
});

test('midnight wraps: 23:59 and 00:00 are both night shift', () => {
  expect(moodAt(at(23, 59)).sky).toEqual(PALETTES.night.sky);
  expect(moodAt(at(0, 0)).sky).toEqual(PALETTES.night.sky);
});

test('10:00 is halfway from sunrise to mint, blended in OKLCH', () => {
  const m = moodAt(at(10));
  expect(m.sky[0]).toBe(blendHex(PALETTES.sunrise.sky[0], PALETTES.mint.sky[0], 0.5));
  expect(m.sky[0]).not.toBe(rgbMix(PALETTES.sunrise.sky[0], PALETTES.mint.sky[0], 0.5));
});

test('an OKLCH blend keeps chroma (no muddy olive), unlike an RGB mix', () => {
  const a = '#ff9e80', b = '#5cc9b5';
  const mid = oklch(blendHex(a, b, 0.5))[1];
  const avg = (oklch(a)[1] + oklch(b)[1]) / 2;
  expect(mid).toBeCloseTo(avg, 2);
  expect(oklch(rgbMix(a, b, 0.5))[1]).toBeLessThan(avg - 0.03);
});

test('blendHex ends: t=0 and t=1 return the inputs', () => {
  expect(blendHex('#ff9e80', '#5cc9b5', 0)).toBe('#ff9e80');
  expect(blendHex('#ff9e80', '#5cc9b5', 1)).toBe('#5cc9b5');
});

test('numbers fade linearly: stars half on at 06:00', () => {
  expect(moodAt(at(6)).starA).toBeCloseTo(0.5);
  expect(moodAt(at(12)).starA).toBe(0);
});

test('the label switches at the blend midpoint', () => {
  expect(moodAt(at(9, 55)).label).toBe('Sunrise');
  expect(moodAt(at(10, 5)).label).toBe('Mint morning');
});

test('moodFor pins a mood whatever the time; auto follows the clock', () => {
  expect(moodFor('night', at(12)).sky).toEqual(PALETTES.night.sky);
  expect(moodFor('auto', at(12)).sky).toEqual(PALETTES.mint.sky);
});

test('moodTokens: night gives dark panels with light text, mint gives light panels', () => {
  const night = moodTokens(PALETTES.night);
  const mint = moodTokens(PALETTES.mint);
  expect(oklch(night['--paper'])[0]).toBeLessThan(0.45);
  expect(oklch(night['--ink'])[0]).toBeGreaterThan(0.85);
  expect(oklch(mint['--paper'])[0]).toBeGreaterThan(0.9);
  expect(Object.keys(mint).sort()).toEqual(['--accent', '--ink', '--ink-soft', '--line', '--lobby', '--paper', '--sky', '--sky-2'].sort());
});
