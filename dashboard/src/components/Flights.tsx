import type { CSSProperties } from 'react';
import type { AgentState, Deploy, Handoff, Release } from '../types';
import { arcPath, project, type IsoLayout, type Pt } from '../iso';

export interface FlightsProps {
  l: IsoLayout;
  agents: AgentState[];
  handoffs: Handoff[];
  deploys: Deploy[];
  released: Release[];
}

/** Screen point just above an agent's desk (the approver's desk for the approver). */
function deskPoint(l: IsoLayout, agents: AgentState[], id: string): Pt | null {
  const a = agents.find((x) => x.id === id);
  if (a?.isApprover) return project(l, l.approver.desk.x + 0.6, l.approver.desk.y, 1);
  const d = l.desks.find((x) => x.id === id);
  return d ? project(l, d.x + 0.75, d.y, 1) : null;
}

function Flight({ path, kind, color }: { path: string; kind: string; color: string }) {
  return (
    <g className={`flight flight-${kind}`} data-testid={`flight-${kind}`} style={{ offsetPath: `path('${path}')`, '--fly': color } as CSSProperties}>
      {kind === 'handoff'
        ? <path d="M-6,-4 h4 l1.5,1.5 h6.5 v7 h-12 z" fill={color} stroke="#2a2f45" strokeWidth={0.6} />
        : <><rect x={-5} y={-5} width={10} height={9} rx={1.5} className="parcel" /><line x1={-5} y1={-1} x2={5} y2={-1} className="parcel-tape" /></>}
    </g>
  );
}

/** Things in the air: folders between desks, parcels to the sandbox and into the vault (spec 8.3). */
export function Flights({ l, agents, handoffs, deploys, released }: FlightsProps) {
  const color = (id: string) => agents.find((a) => a.id === id)?.color ?? '#ffb900';
  const approverId = agents.find((a) => a.isApprover)?.id ?? '';
  return (
    <g className="flights" aria-hidden="true">
      {handoffs.map((h) => {
        const a = deskPoint(l, agents, h.from), b = deskPoint(l, agents, h.to);
        return a && b && <Flight key={`h-${h.from}-${h.to}-${h.time}`} kind="handoff" color={color(h.from)} path={arcPath(a, b)} />;
      })}
      {deploys.map((d) => {
        const a = deskPoint(l, agents, d.agent);
        return a && <Flight key={`d-${d.org}-${d.time}`} kind="deploy" color={color(d.agent)} path={arcPath(a, l.sandbox, 60)} />;
      })}
      {released.map((r) => {
        const a = deskPoint(l, agents, approverId);
        return a && <Flight key={`r-${r.task}-${r.time}`} kind="released" color="#ffb900" path={arcPath(a, l.vault, 20)} />;
      })}
    </g>
  );
}
