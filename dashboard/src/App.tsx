import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTeamState } from './api';
import type { AgentState, Deploy, Handoff, Release, TeamState } from './types';
import { agentName, needsYouTitle } from './labels';
import { Clipboard } from './components/Clipboard';
import { IsoOffice, pct } from './components/IsoOffice';
import { Lobby } from './components/Lobby';
import { ListView } from './components/ListView';
import { Flights } from './components/Flights';
import { NeedsYouSign } from './components/NeedsYouSign';
import { StatusOverlay } from './components/StatusOverlay';
import { MoodPicker } from './components/MoodPicker';
import { SkyOverlays, SkyScene } from './components/SkyCards';
import { FLIGHT_MS, useFresh, useReducedMotion } from './fresh';
import { project } from './iso';
import type { Mood } from './mood';
import { useMood } from './useMood';

/** How long the receiver's plaque reads "New from <sender>". */
export const NEWS_MS = FLIGHT_MS;

/** Below this width the page opens in list view. */
const NARROW = '(max-width: 479px)';

const hKey = (h: Handoff) => `${h.from}|${h.to}|${h.task}|${h.time}`;
const dKey = (d: Deploy) => `${d.org}|${d.time}`;
const rKey = (r: Release) => `${r.task}|${r.state}`;

export function App() {
  const { state, error, offline } = useTeamState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listView, setListView] = useState(() => window.matchMedia(NARROW).matches);
  const handoffs = useFresh(state?.handoffs, hKey, FLIGHT_MS);
  const deploys = useFresh(state?.deploys, dKey, FLIGHT_MS);
  const released = useFresh(state?.releases, rKey, FLIGHT_MS).filter((r) => r.state === 'released');
  const { choice, setChoice, mood } = useMood();

  const approver = state?.agents.find((a) => a.isApprover) ?? null;
  const needsTitle = state && approver && state.needsYou.length > 0
    ? needsYouTitle(approver.name, state.needsYou.length) : '';

  // One tree for every state, so the toolbar (and its mood picker) never remounts.
  return (
    <main className="scene">
      {state && (
        <>
          <div className="cloud" aria-hidden="true" />
          <div className="cloud cloud-far" aria-hidden="true" />
        </>
      )}
      <div className="toolbar">
        <MoodPicker choice={choice} setChoice={setChoice} />
        <button type="button" className="view-toggle" onClick={() => setListView((v) => !v)}>
          {listView ? 'Office view' : 'List view'}
        </button>
      </div>
      {/* Announces the needs-you title when it changes (the sign itself is not a live region). */}
      <p className="visually-hidden" aria-live="polite">{needsTitle}</p>
      {state ? (
        <div className="scene-body" inert={Boolean(error) || offline}>
          {listView ? <ListView state={state} /> : (
            <Office state={state} mood={mood} approver={approver} handoffs={handoffs} deploys={deploys} released={released} selectedId={selectedId} setSelectedId={setSelectedId} />
          )}
        </div>
      ) : !error && !offline && <p className="scene-opening">Opening the office</p>}
      <StatusOverlay error={error} offline={offline} />
    </main>
  );
}

interface OfficeProps {
  state: TeamState;
  mood: Mood;
  approver: AgentState | null;
  handoffs: Handoff[];
  deploys: Deploy[];
  released: Release[];
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}

/** The isometric office with its sign and lobby, and the clipboard beside it. */
function Office({ state, mood, approver, handoffs, deploys, released, selectedId, setSelectedId }: OfficeProps) {
  const selected = state.agents.find((a) => a.id === selectedId) ?? null;
  const still = useReducedMotion();
  const plaques: Record<string, string> = {};
  for (const h of handoffs) plaques[h.to] = `New from ${agentName(state.agents, h.from)}`;

  return (
    <div className="office">
      <div className="office-main">
        <IsoOffice
          state={state}
          mood={mood}
          selectedId={selected?.id ?? null}
          onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
          plaques={plaques}
          scene={(l) => (
            <>
              <SkyScene l={l} state={state} mood={mood} />
              <Flights l={l} agents={state.agents} handoffs={still ? [] : handoffs} deploys={still ? [] : deploys} released={still ? [] : released} />
            </>
          )}
          overlays={(l) => (
            <>
              {approver && (
                <div className="iso-sign" style={pct(l, project(l, 9.6, l.approver.y0 + 0.4, 2.6))}>
                  <NeedsYouSign approver={approver} items={state.needsYou} agents={state.agents} onOpen={() => setSelectedId(approver.id)} />
                </div>
              )}
              <SkyOverlays l={l} state={state} />
            </>
          )}
        />
        <Lobby tasks={state.tasks} agents={state.agents} />
      </div>
      <Clipboard
        agent={selected}
        events={selected ? state.agentLogs[selected.id] ?? [] : []}
        needsYou={state.needsYou}
        agents={state.agents}
        tasks={state.tasks}
        deploys={state.deploys}
        now={state.updatedAt}
      />
    </div>
  );
}
