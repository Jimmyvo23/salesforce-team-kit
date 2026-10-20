import type { TeamState } from '../types';
import { project, type IsoLayout } from '../iso';
import type { Mood } from '../mood';
import { Puff, pct } from './IsoOffice';
import { ProgressBar } from './ProgressBar';
import { activeTasks, deployLine, guardBubbles, lastReleased, latestDeploy, readyReleases } from '../office-data';
import { agentName } from '../labels';

/** SVG: sandbox cloud (top right), production vault (bottom right), change-set parcel on the approver desk. */
export function SkyScene({ l, state, mood: m }: { l: IsoLayout; state: TeamState; mood: Mood }) {
  const dep = latestDeploy(state.deploys);
  const approver = state.agents.find((a) => a.isApprover);
  const released = lastReleased(state.releases);
  const ready = readyReleases(state.releases);
  const [sx, sy] = l.sandbox, [vx, vy] = l.vault;
  const text = m.dark >= 0.5 ? '#ffffff' : m.ink;
  const sub = m.dark >= 0.5 ? '#c9cfee' : m.sub;
  const [px, py] = project(l, l.approver.desk.x + 0.6, l.approver.desk.y, 0.9);
  return (
    <>
      <g className="float" data-testid="sandbox-cloud">
        <Puff x={sx} y={sy} s={1.7} fill={m.cloud} />
        <text x={sx} y={sy - 2} textAnchor="middle" className="sky-title" fill={text}>{dep ? dep.org : 'Sandbox'}</text>
        <text x={sx} y={sy + 7} textAnchor="middle" className="sky-sub" fill={dep?.result === 'failed' ? 'var(--alert)' : sub}>
          {dep ? deployLine(dep) : 'No deploys yet'}
        </text>
      </g>
      <g data-testid="vault-cloud">
        <Puff x={vx} y={vy} s={1.9} fill={m.vault} />
        <text x={vx} y={vy - 3} textAnchor="middle" className="sky-title" fill={text}>🔒 Production</text>
        <text x={vx} y={vy + 5} textAnchor="middle" className="sky-sub" fill={sub}>{`deployed by ${approver?.name ?? 'the approver'} via change set`}</text>
        {released && <text x={vx} y={vy + 12} textAnchor="middle" className="sky-sub" fill={sub}>{`${released.task} released`}</text>}
        <title>{`Production · deployed by ${approver?.name ?? 'the approver'} via change set`}</title>
      </g>
      {ready.length > 0 && (
        <g data-testid="changeset-parcel" transform={`translate(${px},${py})`}>
          <rect x={-5} y={-5} width={10} height={9} rx={1.5} className="parcel" />
          <line x1={-5} y1={-1} x2={5} y2={-1} className="parcel-tape" />
          <text x={8} y={2} className="sky-sub parcel-text" fill={text}>
            {`Change set ready · ${ready[0].components} component${ready[0].components === 1 ? '' : 's'}${ready.length > 1 ? ` (+${ready.length - 1} more)` : ''}`}
          </text>
        </g>
      )}
    </>
  );
}

/** HTML: the Tasks cloud card (top left) and guard-blocked bubbles at desks. */
export function SkyOverlays({ l, state }: { l: IsoLayout; state: TeamState }) {
  const tasks = activeTasks(state.tasks);
  const bubbles = guardBubbles(state.guardBlocks, state.updatedAt);
  return (
    <>
      <section className="tasks-card" aria-label="Tasks">
        <h2>Tasks</h2>
        {tasks.length === 0 ? <p>No active tasks.</p> : (
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <span className="tasks-card-name"><b>{t.id}</b> {t.title}</span>
                <ProgressBar small label={`${t.id} ${t.title}`} progress={t.progress} stage={t.stage}
                  color={state.agents.find((a) => a.id === t.owner)?.color} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {Object.values(bubbles).map((b) => {
        const d = l.desks.find((x) => x.id === b.agent);
        if (!d) return null;
        return (
          <div key={b.agent} className="guard-bubble" data-testid={`guard-bubble-${b.agent}`} role="status"
            style={pct(l, project(l, d.x + 0.3, d.y, 3.2))}>
            🛡 Guard blocked <span className="visually-hidden">{agentName(state.agents, b.agent)}: {b.reason}</span>
          </div>
        );
      })}
    </>
  );
}
