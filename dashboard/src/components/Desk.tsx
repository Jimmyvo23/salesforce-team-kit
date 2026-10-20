import type { CSSProperties, KeyboardEvent } from 'react';
import type { AgentState } from '../types';
import type { IsoLayout } from '../iso';
import { boxFaces, project } from '../iso';
import type { Mood } from '../mood';
import { deskLabel, STATE_LABELS } from '../labels';
import { deskState } from '../office-data';

export interface DeskProps {
  l: IsoLayout;
  agent: AgentState;
  x: number;
  y: number;
  mood: Mood;
  selected: boolean;
  /** "New from <sender>" for a few seconds after a handoff (Task 7). */
  plaque?: string;
  describedBy?: string;
  onSelect: (id: string) => void;
}

const SHORT = 22;
const short = (s: string) => (s.length > SHORT ? `${s.slice(0, SHORT - 1)}…` : s);

/** One desk: floor glow, person, desk box, monitor showing the state, and the name chip. */
export function Desk({ l, agent: a, x, y, mood, selected, plaque, describedBy, onSelect }: DeskProps) {
  const ds = deskState(a.status);
  const desk = boxFaces(l, x, y, 0, 1.5, 0.85, 0.62);
  const mon = boxFaces(l, x + 0.45, y + 0.1, 0.62, 0.6, 0.08, 0.42);
  const [gx, gy] = project(l, x + 0.75, y + 0.4);
  const [px, py] = project(l, x + 0.7, y - 0.55, 0.45);
  const [sx, sy] = project(l, x + 0.75, y + 0.1, 0.83);
  // No task: the state alone ("On a break"); the full wording stays in the aria-label and the preview.
  const line = plaque ?? (a.currentTask ? `${STATE_LABELS[a.status]} · ${short(a.currentTask)}` : STATE_LABELS[a.status]);
  const w = Math.max(a.name.length * 4, line.length * 2.9) + 17;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a.id); }
  };
  return (
    <g
      className={`desk is-${ds}${selected ? ' is-selected' : ''}`}
      data-agent={a.id}
      role="button"
      tabIndex={0}
      aria-label={deskLabel(a)}
      aria-pressed={selected}
      aria-describedby={describedBy}
      onClick={() => onSelect(a.id)}
      onKeyDown={onKey}
      style={{ '--owner': a.color } as CSSProperties}
    >
      <rect className="desk-hit" x={gx - 30} y={py - 30} width={60} height={gy - py + 44} />
      <ellipse className="desk-glow" cx={gx} cy={gy} rx={34} ry={20} />
      <g className="person">
        <rect x={px - 7} y={py - 18} width={14} height={17} rx={6} fill={a.color} />
        <circle cx={px} cy={py - 24} r={6} fill="#f3c9a8" />
      </g>
      <polygon points={desk.top} fill={mood.deskT} />
      <polygon points={desk.left} fill={mood.deskL} />
      <polygon points={desk.right} fill={mood.deskR} />
      <polygon points={mon.top} fill={mood.mon} />
      <polygon points={mon.left} fill={mood.mon} />
      <polygon className="desk-screen" points={mon.right} />
      <g className="desk-screen-mark" transform={`translate(${sx},${sy})`}>
        {ds === 'blocked' && <text className="mark-alert" textAnchor="middle" y={2}>!</text>}
        {ds === 'done' && <text className="mark-done" textAnchor="middle" y={2}>✓</text>}
        {ds === 'waiting' && <text className="mark-wait" textAnchor="middle" y={1}>···</text>}
        {ds === 'working' && <g className="mark-code"><rect x={-3} y={-2} width={6} height={0.8} /><rect x={-3} y={0} width={4} height={0.8} /></g>}
        {ds === 'free' && <circle className="mark-saver" r={0.9} />}
      </g>
      {a.isVisitor && <text className="hot-desk" x={gx} y={gy + 22} textAnchor="middle">Hot desk</text>}
      <g className="chip" transform={`translate(${px - w / 2},${py - 52})`}>
        <rect width={w} height={17} rx={8.5} />
        <circle className={`chip-dot dot-${ds}`} cx={7.5} cy={6.5} r={2.4} />
        <text className="chip-name" x={12} y={8.5}>{a.name}</text>
        <text className="chip-task" x={7.5} y={14.2}>{line}</text>
      </g>
    </g>
  );
}
