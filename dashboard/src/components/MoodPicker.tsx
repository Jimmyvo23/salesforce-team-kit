import { MOODS, type MoodChoice } from '../mood';

const OPTIONS: { value: MoodChoice; label: string }[] = [{ value: 'auto', label: 'Auto' }, ...MOODS];

/** Mood radio group: Auto follows the day; the others pin a mood. */
export function MoodPicker({ choice, setChoice }: { choice: MoodChoice; setChoice: (c: MoodChoice) => void }) {
  return (
    <div className="mood-picker" role="radiogroup" aria-label="Mood">
      {OPTIONS.map((o) => (
        <label key={o.value} className={choice === o.value ? 'is-on' : undefined}>
          <input type="radio" name="mood" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
