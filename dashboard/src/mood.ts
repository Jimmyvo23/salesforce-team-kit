/** Day-cycle palettes for the office (spec 8.5). Pure: no DOM. Colours from the mockup's PAL. */

export type MoodName = 'night' | 'sunrise' | 'mint' | 'twilight';
export type MoodChoice = 'auto' | MoodName;

export interface Mood {
  label: string;
  sky: [string, string];
  win: [string, string];
  cloud: string; cloudFar: string; wallA: string; wallB: string; floor: string; grid: string; rug: string;
  deskT: string; deskL: string; deskR: string; mon: string; screen: string;
  ink: string; sub: string; accent: string; jim: string; vault: string; moon: string; plant: string;
  /** 0–1 fades and the sun/moon position. */
  starA: number; lampA: number; orbX: number; orbY: number; orbR: number; orbA: number;
  /** 1 = dark scene (light text on panels), 0 = light. */
  dark: number;
}

export const PALETTES: Record<MoodName, Mood> = {
  sunrise: { label: 'Sunrise', sky: ['#ff9e80', '#ffe2c2'], win: ['#ff9e80', '#ffe2c2'], cloud: '#fff8f1', cloudFar: '#ffffff', wallA: '#fff3e8', wallB: '#f7e2d1', floor: '#fffaf5', grid: '#f4e6d8', rug: '#ffe6d8',
    deskT: '#f6d2a9', deskL: '#e3b585', deskR: '#d2a275', mon: '#3a2b45', screen: '#ffb26b', ink: '#43263a', sub: '#8a6a72', accent: '#e0663d', jim: '#fff1c9', vault: '#ffe0cf', moon: '#fff3d6', plant: '#5aa86b',
    starA: 0, lampA: 0, orbX: 60, orbY: 150, orbR: 30, orbA: 0.95, dark: 0 },
  twilight: { label: 'Twilight', sky: ['#2a215f', '#9a6fd0'], win: ['#3a2f7a', '#d9a0d6'], cloud: '#efe8ff', cloudFar: '#d9ccff', wallA: '#f4f0ff', wallB: '#e1d8fb', floor: '#fbf9ff', grid: '#ece6fb', rug: '#ece4ff',
    deskT: '#ffffff', deskL: '#ddd3f8', deskR: '#cbbdf2', mon: '#2a2350', screen: '#b99cff', ink: '#2a2350', sub: '#6d6390', accent: '#7a56e6', jim: '#fff2c4', vault: '#d9ccff', moon: '#fff4d1', plant: '#58a77a',
    starA: 0.8, lampA: 0.3, orbX: 52, orbY: 44, orbR: 13, orbA: 0.9, dark: 0 },
  mint: { label: 'Mint morning', sky: ['#5cc9b5', '#e6faf4'], win: ['#5cc9b5', '#e6faf4'], cloud: '#ffffff', cloudFar: '#ffffff', wallA: '#f2fbf7', wallB: '#dcf1e8', floor: '#fbfffd', grid: '#e3f3ec', rug: '#dcf4ea',
    deskT: '#ffffff', deskL: '#d2eadf', deskR: '#bddcd0', mon: '#1f3d3a', screen: '#6fe3c8', ink: '#173b36', sub: '#5b7a74', accent: '#0f8a6c', jim: '#fff5cf', vault: '#d5efe6', moon: '#ffffff', plant: '#3f9d6a',
    starA: 0, lampA: 0, orbX: 300, orbY: 30, orbR: 16, orbA: 0, dark: 0 },
  night: { label: 'Night shift', sky: ['#0b1030', '#26326a'], win: ['#0b1030', '#3a4a90'], cloud: '#3b4680', cloudFar: '#2e3870', wallA: '#2b3460', wallB: '#232b52', floor: '#323c6b', grid: '#2b3460', rug: '#3b4880',
    deskT: '#c79a6c', deskL: '#a57a52', deskR: '#8f6844', mon: '#111531', screen: '#ffd56b', ink: '#1d2340', sub: '#5f6788', accent: '#ffd56b', jim: '#5b4a2a', vault: '#2e3870', moon: '#fff1c2', plant: '#4c9a6c',
    starA: 1, lampA: 1, orbX: 52, orbY: 44, orbR: 13, orbA: 0.95, dark: 1 },
};

export const MOODS: { value: MoodName; label: string }[] = [
  { value: 'night', label: 'Night shift' },
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'mint', label: 'Mint morning' },
  { value: 'twilight', label: 'Twilight' },
];

/** [hour, mood] keyframes in local time; flat between a pair with the same mood. */
const KEYS: [number, MoodName][] = [
  [0, 'night'], [5, 'night'], [7, 'sunrise'], [9.5, 'sunrise'], [10.5, 'mint'], [16.5, 'mint'],
  [17.5, 'twilight'], [19.5, 'twilight'], [21, 'night'], [24, 'night'],
];

// --- OKLCH (Björn Ottosson's OKLab matrices) ---
type V3 = [number, number, number];
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLin = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
const hexRgb = (h: string): V3 => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as V3;
const rgbHex = (c: V3) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function oklab(hex: string): V3 {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labHex([L, a, b]: V3): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbHex([
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** [lightness 0–1, chroma, hue degrees] of a #rrggbb colour. */
export function oklch(hex: string): V3 {
  const [L, a, b] = oklab(hex);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

/** Blend two #rrggbb colours in OKLCH, hue the short way round. */
export function blendHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [L1, C1, H1] = oklch(a);
  const [L2, C2, H2] = oklch(b);
  // A grey has no hue: borrow the other colour's so the blend does not swing through a random hue.
  const h1 = C1 < 0.02 ? H2 : H1;
  const h2 = C2 < 0.02 ? H1 : H2;
  const dh = ((h2 - h1 + 540) % 360) - 180;
  const L = L1 + (L2 - L1) * t, C = C1 + (C2 - C1) * t, H = ((h1 + dh * t) * Math.PI) / 180;
  return labHex([L, C * Math.cos(H), C * Math.sin(H)]);
}

function blend(A: Mood, B: Mood, t: number): Mood {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(A) as (keyof Mood)[]) {
    const x = A[k], y = B[k];
    if (typeof x === 'number') out[k] = x + ((y as number) - x) * t;
    else if (Array.isArray(x)) out[k] = x.map((v, i) => blendHex(v, (y as string[])[i], t));
    else if (k === 'label') out[k] = t < 0.5 ? x : y;
    else out[k] = blendHex(x as string, y as string, t);
  }
  return out as unknown as Mood;
}

/** The palette for a local time. */
export function moodAt(date: Date): Mood {
  const h = date.getHours() + date.getMinutes() / 60;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, A] = KEYS[i], [b, B] = KEYS[i + 1];
    if (h >= a && h <= b) return A === B ? PALETTES[A] : blend(PALETTES[A], PALETTES[B], (h - a) / (b - a));
  }
  return PALETTES.night;
}

export function moodFor(choice: MoodChoice, date: Date): Mood {
  return choice === 'auto' ? moodAt(date) : PALETTES[choice];
}

/** CSS custom properties for the page chrome (toolbar, clipboard, board, list view). */
export function moodTokens(m: Mood): Record<string, string> {
  const dark = m.dark >= 0.5;
  return {
    '--sky': m.sky[0],
    '--sky-2': m.sky[1],
    '--paper': dark ? m.wallB : '#ffffff',
    '--lobby': m.wallA,
    '--ink': dark ? '#eef1ff' : m.ink,
    '--ink-soft': dark ? '#c9cfee' : m.sub,
    '--line': m.grid,
    '--accent': m.accent,
  };
}
