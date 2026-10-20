import { useEffect, useLayoutEffect, useState } from 'react';
import { moodFor, moodTokens, MOODS, type Mood, type MoodChoice } from './mood';

export const MOOD_KEY = 'salesforce-team-kit.mood';
const MINUTE = 60_000;

/** Stored choice, or Auto. Storage can be missing or throw (private windows, blocked site data). */
function readChoice(): MoodChoice {
  try {
    const v = window.localStorage.getItem(MOOD_KEY);
    return v === 'auto' || MOODS.some((m) => m.value === v) ? (v as MoodChoice) : 'auto';
  } catch {
    return 'auto';
  }
}

function saveChoice(c: MoodChoice): void {
  try {
    window.localStorage.setItem(MOOD_KEY, c);
  } catch {
    // Not remembered in this browser; the page still works.
  }
}

/** The chosen mood and the palette for right now, refreshed once a minute. Applies chrome tokens to <html>. */
export function useMood(): { choice: MoodChoice; setChoice: (c: MoodChoice) => void; mood: Mood } {
  const [choice, setChoiceState] = useState<MoodChoice>(readChoice);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE);
    return () => clearInterval(id);
  }, []);

  const mood = moodFor(choice, now);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.mood = choice;
    root.dataset.dark = String(mood.dark >= 0.5);
    for (const [k, v] of Object.entries(moodTokens(mood))) root.style.setProperty(k, v);
  }, [choice, mood]);

  const setChoice = (c: MoodChoice) => { setChoiceState(c); saveChoice(c); };
  return { choice, setChoice, mood };
}
