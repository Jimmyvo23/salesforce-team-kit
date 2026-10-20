import { useState, type ReactNode } from 'react';
import type { AgentState, TeamState } from '../types';
import { boxFaces, layout, project, pts, type IsoLayout, FLOOR_W } from '../iso';
import type { Mood } from '../mood';
import { Desk } from './Desk';
import { PreviewCard } from './PreviewCard';

export interface IsoOfficeProps {
  state: TeamState;
  mood: Mood;
  selectedId: string | null;
  onSelect: (id: string) => void;
  plaques?: Record<string, string>;
  /** HTML laid over the scene (needs-you sign, Tasks card). Positioned by the caller via `pct`. */
  overlays?: (l: IsoLayout) => ReactNode;
  /** Extra SVG drawn above the desks (sky cards, flights). */
  scene?: (l: IsoLayout) => ReactNode;
}

/** Percent position of a screen point inside the scene, for HTML overlays. */
export const pct = (l: IsoLayout, [x, y]: [number, number]) => ({ left: `${(x / l.width) * 100}%`, top: `${(y / l.height) * 100}%` });

export function Puff({ x, y, s, fill, op = 1 }: { x: number; y: number; s: number; fill: string; op?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} opacity={op}>
      <circle cx={-14} cy={2} r={10} fill={fill} /><circle cx={0} cy={-5} r={14} fill={fill} />
      <circle cx={15} cy={0} r={11} fill={fill} /><rect x={-24} y={0} width={50} height={12} rx={6} fill={fill} />
    </g>
  );
}

/** The isometric cloud office (spec 8.2): one desk per member, three per row; approver in the glass office. */
export function IsoOffice({ state, mood: m, selectedId, onSelect, plaques, overlays, scene }: IsoOfficeProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const members = state.agents.filter((a) => !a.isApprover);
  const approver = state.agents.find((a) => a.isApprover) ?? null;
  const l = layout(members.map((a) => a.id));
  const P = (x: number, y: number, z = 0) => project(l, x, y, z);
  const { x0, y0, x1, y1, desk } = l.approver;
  const byId = new Map(state.agents.map((a) => [a.id, a]));
  const preview = previewId ? byId.get(previewId) ?? null : null;
  const spots: { agent: AgentState; x: number; y: number }[] = [
    ...l.desks.map((d) => ({ agent: byId.get(d.id)!, x: d.x, y: d.y })),
    ...(approver ? [{ agent: approver, x: desk.x, y: desk.y }] : []),
  ];

  return (
    <section className="iso-office" aria-label="Office">
      <h1 className="iso-title">{`${state.project} team`}</h1>
      <div className="iso-wrap" onKeyDown={(e) => { if (e.key === 'Escape') setPreviewId(null); }}>
        <svg viewBox={`0 0 ${l.width} ${l.height}`} className="iso-scene" role="group" aria-label="Desks">
          <defs>
            <linearGradient id="iso-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={m.sky[0]} /><stop offset="1" stopColor={m.sky[1]} /></linearGradient>
            <linearGradient id="iso-win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={m.win[0]} /><stop offset="1" stopColor={m.win[1]} /></linearGradient>
          </defs>
          <rect width={l.width} height={l.height} fill="url(#iso-sky)" />
          {m.starA > 0.02 && (
            <g opacity={m.starA} aria-hidden="true">
              {Array.from({ length: 34 }, (_, i) => (
                <circle key={i} cx={(i * 97) % l.width} cy={(i * 53) % 150} r={i % 5 ? 0.7 : 1.2} fill="#fff" className={i % 3 ? undefined : 'twinkle'} />
              ))}
            </g>
          )}
          <circle cx={m.orbX} cy={m.orbY} r={m.orbR} fill={m.moon} opacity={m.orbA} aria-hidden="true" />
          <g className="drift" aria-hidden="true"><Puff x={40} y={40} s={1} fill={m.cloudFar} op={0.7} /></g>
          <g className="drift drift-2" aria-hidden="true"><Puff x={40} y={90} s={0.7} fill={m.cloudFar} op={0.55} /></g>
          {/* The cloud the office floats on. */}
          <g aria-hidden="true">
            {[[0, l.depth], [3, l.depth + 0.6], [6, l.depth + 0.8], [9, l.depth + 0.4], [FLOOR_W + 0.4, l.depth - 2], [FLOOR_W + 0.6, l.depth / 2], [FLOOR_W + 0.2, 0.5]].map(([x, y], i) => {
              const [cx, cy] = P(x, y);
              return <ellipse key={i} cx={cx} cy={cy + 12} rx={34 + (i % 2) * 8} ry={18} fill={m.cloud} />;
            })}
            <polygon points={pts([P(0, 0), P(FLOOR_W, 0), P(FLOOR_W, 0, 3.2), P(0, 0, 3.2)])} fill={m.wallA} />
            <polygon points={pts([P(0, 0), P(0, l.depth), P(0, l.depth, 3.2), P(0, 0, 3.2)])} fill={m.wallB} />
            {[0, 1, 2].map((i) => <polygon key={i} points={pts([P(1.2 + i * 2.6, 0, 1.1), P(2.8 + i * 2.6, 0, 1.1), P(2.8 + i * 2.6, 0, 2.7), P(1.2 + i * 2.6, 0, 2.7)])} fill="url(#iso-win)" />)}
            <polygon points={pts([P(0, 0), P(FLOOR_W, 0), P(FLOOR_W, l.depth), P(0, l.depth)])} fill={m.floor} />
            {Array.from({ length: FLOOR_W - 1 }, (_, i) => {
              const [ax, ay] = P(i + 1, 0), [bx, by] = P(i + 1, l.depth);
              return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke={m.grid} strokeWidth={0.8} />;
            })}
            <polygon points={pts([P(1, 1.1), P(7.4, 1.1), P(7.4, l.depth - 1), P(1, l.depth - 1)])} fill={m.rug} />
            <polygon className="glass-floor" points={pts([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)])} fill={m.jim} />
            <polygon className="glass-wall" points={pts([P(x0, y0), P(x0, y1), P(x0, y1, 2.2), P(x0, y0, 2.2)])} />
            {(() => { const pot = boxFaces(l, 10.2, 0.4, 0, 0.6, 0.6, 0.5); const [tx, ty] = P(10.5, 0.7, 1.1); return (<>
              <polygon points={pot.top} fill="#c7714c" /><polygon points={pot.left} fill="#a85c3c" /><polygon points={pot.right} fill="#954f33" />
              <circle cx={tx} cy={ty} r={11} fill={m.plant} /></>); })()}
          </g>
          {spots.map(({ agent, x, y }) => (
            <g key={agent.id}
              onMouseEnter={() => setPreviewId(agent.id)}
              onMouseLeave={() => setPreviewId((id) => (id === agent.id ? null : id))}
              onFocus={() => setPreviewId(agent.id)}
              onBlur={() => setPreviewId((id) => (id === agent.id ? null : id))}
            >
              <Desk l={l} agent={agent} x={x} y={y} mood={m} selected={agent.id === selectedId}
                plaque={plaques?.[agent.id]} describedBy={previewId === agent.id ? `preview-${agent.id}` : undefined}
                onSelect={onSelect} />
            </g>
          ))}
          {scene?.(l)}
        </svg>
        {preview && (() => {
          const spot = spots.find((s) => s.agent.id === preview.id)!;
          return <div className="iso-preview" style={pct(l, project(l, spot.x + 0.75, spot.y, 2.6))}><PreviewCard agent={preview} id={`preview-${preview.id}`} /></div>;
        })()}
        {overlays?.(l)}
      </div>
    </section>
  );
}
