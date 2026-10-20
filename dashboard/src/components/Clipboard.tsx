import type { AgentLogEntry, AgentState, Deploy, NeedsYouItem, Task } from '../types';
import { lastDeployBy, deployLine } from '../office-data';
import { ProgressBar } from './ProgressBar';
import { ago, clockTime, needsYouLine, NOTHING_ASSIGNED, staleWarning, STATE_LABELS } from '../labels';

export const CLIPBOARD_EVENTS = 20;

export interface ClipboardProps {
  /** The pinned agent, or null when nothing is pinned yet. */
  agent: AgentState | null;
  /** That agent's log, oldest first (state.agentLogs[agent.id]). */
  events: AgentLogEntry[];
  /** Everything that needs the approver, listed on the approver's clipboard. */
  needsYou: NeedsYouItem[];
  /** All agents, for names in the needs-you list. */
  agents: AgentState[];
  /** All tasks, to show the pinned agent's current task bar. */
  tasks: Task[];
  /** All sandbox deploys, to show the pinned agent's last one. */
  deploys: Deploy[];
  /** Server clock (state.updatedAt); every relative time is measured against it. */
  now: string;
}

/** The clipboard on the right: details of the pinned agent. */
export function Clipboard({ agent, events, needsYou, agents, tasks, deploys, now }: ClipboardProps) {
  return (
    <aside className="clipboard" aria-label="Details">
      {agent ? <AgentDetails agent={agent} events={events} needsYou={needsYou} agents={agents} tasks={tasks} deploys={deploys} now={now} /> : (
        <p className="clipboard-empty">Pick a desk to pin what that person is doing here.</p>
      )}
    </aside>
  );
}

type AgentDetailsProps = Omit<ClipboardProps, 'agent'> & { agent: AgentState };

function AgentDetails({ agent: a, events, needsYou, agents, tasks, deploys, now }: AgentDetailsProps) {
  const task = tasks.find((t) => t.id === a.currentTask) ?? null;
  const deploy = lastDeployBy(a.id, deploys);
  const stale = staleWarning(a, now);
  const recent = events.slice(-CLIPBOARD_EVENTS).reverse();
  const fill = a.status === 'blocked' ? 'var(--alert)' : a.color;

  return (
    <>
      <div aria-live="polite">
        <h2 className="clipboard-name">{a.name}</h2>
        <p className="clipboard-role">{a.role}</p>
        <span className={`state-pill state-${a.status}`}>{STATE_LABELS[a.status]}</span>
      </div>
      {stale && <p className="clipboard-stale">{stale}</p>}
      <dl className="clipboard-facts">
        <dt>{a.isApprover ? 'On your desk' : 'Working on'}</dt>
        <dd>{a.currentTask ?? NOTHING_ASSIGNED}</dd>
        {a.status === 'blocked' && a.reason && (
          <>
            <dt>Why it is stuck</dt>
            <dd>{a.reason}</dd>
          </>
        )}
        {a.isApprover ? (
          needsYou.length > 0 && (
            <>
              <dt>Needs you</dt>
              <dd>
                <ul className="clipboard-approvals">
                  {needsYou.map((item) => {
                    const line = needsYouLine(item, agents);
                    return <li key={`${item.kind}-${item.id}`}><strong>{line.title}</strong> {line.detail}</li>;
                  })}
                </ul>
              </dd>
            </>
          )
        ) : (
          <>
            <dt id={`progress-${a.id}`}>Progress</dt>
            <dd>
              {a.progress}%
              <div
                className="meter"
                role="progressbar"
                aria-labelledby={`progress-${a.id}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={a.progress}
              >
                <div style={{ width: `${a.progress}%`, background: fill }} />
              </div>
              {a.stoppedAtProgress !== null && <span className="clipboard-note">Stopped at {a.stoppedAtProgress}%</span>}
            </dd>
            {task && (
              <>
                <dt>Task</dt>
                <dd><ProgressBar label={`${task.id} ${task.title}`} progress={task.progress} stage={task.stage} color={a.color} /></dd>
              </>
            )}
            {deploy && (
              <>
                <dt>Last deploy</dt>
                <dd>{`${deploy.org} · ${deployLine(deploy)}`} <span className="clipboard-note">{ago(deploy.time, now)}</span></dd>
              </>
            )}
            <dt>Next step</dt>
            <dd>{a.nextStep ?? 'Not set yet'}</dd>
          </>
        )}
      </dl>
      <div className="clipboard-history">
        <h3>Recent activity</h3>
        {recent.length === 0 ? <p className="clipboard-quiet">Nothing yet.</p> : (
          <ol>
            {recent.map((e, i) => (
              <li key={`${e.time}-${i}`}><time dateTime={e.time}>{clockTime(e.time)}</time>{e.event}</li>
            ))}
          </ol>
        )}
        <p className="clipboard-updated">{a.updatedAt ? `Updated ${ago(a.updatedAt, now)}` : 'No updates yet'}</p>
      </div>
    </>
  );
}
