/** Task progress: a bar, the percentage and the stage (spec 8.4a). */
export function ProgressBar({ label, progress, stage, color, small }: { label: string; progress: number; stage: string; color?: string; small?: boolean }) {
  return (
    <div className={`task-bar${small ? ' task-bar-small' : ''}`}>
      <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progress} aria-valuetext={`${progress}%, ${stage}`}>
        <div style={{ width: `${progress}%`, background: color ?? 'var(--accent)' }} />
      </div>
      <span className="task-bar-text">{progress}% · {stage}</span>
    </div>
  );
}
