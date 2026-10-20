import { useState, type CSSProperties } from 'react';
import type { AgentState, Task, TaskState } from '../types';
import { agentName, TASK_COLUMNS } from '../labels';
import { capColumn, LOBBY_MAX } from '../lobby';
import { ProgressBar } from './ProgressBar';

export interface LobbyProps {
  tasks: Task[];
  agents: AgentState[];
}

/** Ground floor of the building: the task board, four columns, at most 3 tickets each until expanded. */
export function Lobby({ tasks, agents }: LobbyProps) {
  const [open, setOpen] = useState<Partial<Record<TaskState, boolean>>>({});

  return (
    <section className="lobby" aria-label="Task board">
      <div className="lobby-board">
        {TASK_COLUMNS.map(({ state, label }) => {
          const column = tasks.filter((t) => t.state === state);
          const capped = capColumn(column);
          const shown = open[state] ? column : capped.shown;
          const listId = `lobby-${state}`;
          return (
            <div className="lobby-column" key={state}>
              {/* Read as "To do, 1 task". Hidden text inside would pick up a stray space in Chrome's name. */}
              <h3 aria-label={`${label}, ${column.length} ${column.length === 1 ? 'task' : 'tasks'}`}>
                {label} <span className="lobby-count">{column.length}</span>
              </h3>
              <ul id={listId} aria-label={label}>
                {shown.map((t) => {
                  const owner = agents.find((a) => a.id === t.owner);
                  return (
                    <li key={t.id} className="ticket" style={{ '--owner': owner?.color ?? 'var(--clip-metal)' } as CSSProperties}>
                      <span className="ticket-title"><b>{t.id}</b> {t.title}</span>
                      <span className="ticket-owner">{agentName(agents, t.owner)}</span>
                      <ProgressBar small label={`${t.id} ${t.title}`} progress={t.progress} stage={t.stage} color={owner?.color} />
                    </li>
                  );
                })}
              </ul>
              {column.length > LOBBY_MAX && (
                // One button per column that stays mounted, so focus stays on it when it flips.
                <button
                  type="button"
                  className="lobby-more"
                  aria-controls={listId}
                  aria-expanded={Boolean(open[state])}
                  onClick={() => setOpen((o) => ({ ...o, [state]: !o[state] }))}
                >
                  {open[state] ? 'Show fewer' : `and ${capped.more} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="lobby-floor" aria-hidden="true">Lobby</div>
    </section>
  );
}
