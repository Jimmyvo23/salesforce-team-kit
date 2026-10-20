// Mirrors the TeamState built by lib/state.mjs (derive) and served at GET /api/team.

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'awaiting_approval' | 'done';
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'changes_requested';
export type TaskState = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface AgentState {
  id: string;
  name: string;
  role: string;
  color: string;
  status: AgentStatus;
  currentTask: string | null;
  progress: number;
  nextStep: string | null;
  reason: string | null;
  lastAction: string | null;
  updatedAt: string | null;
  stale: boolean;
  stoppedAtProgress: number | null;
  isApprover: boolean;
  isVisitor: boolean;
}

export interface Approval {
  id: string;
  requestedBy: string;
  summary: string;
  state: ApprovalState;
  requestedAt: string;
  decidedAt: string | null;
  note: string;
  agents: string[];
  task: string | null;
}

export interface Task {
  id: string;
  title: string;
  owner: string;
  state: TaskState;
  notes: string;
  progress: number;
  stage: string;
}

export interface Deploy {
  org: string;
  agent: string;
  result: 'passed' | 'failed';
  tests: string | null;
  coverage: number | null;
  task: string | null;
  time: string;
}

export interface Release {
  task: string;
  state: 'ready' | 'released';
  components: number;
  file: string | null;
  time: string;
}

export interface GuardBlock {
  agent: string;
  command: string;
  reason: string;
  time: string;
}

export interface LogEntry {
  time: string;
  agent: string;
  event: string;
}

export interface AgentLogEntry {
  time: string;
  event: string;
}

export interface NeedsYouItem {
  kind: 'approval' | 'blocked' | 'escalation';
  id: string;
  summary: string;
}

export interface Handoff {
  from: string;
  to: string;
  task: string;
  time: string;
}

export interface TeamState {
  updatedAt: string;
  project: string;
  agents: AgentState[];
  approvals: Approval[];
  tasks: Task[];
  /** Latest deploy per org. */
  deploys: Deploy[];
  releases: Release[];
  /** Last 10 guard blocks, oldest first. */
  guardBlocks: GuardBlock[];
  log: LogEntry[];
  /** Keyed by agent id; at most 20 entries each, oldest first. */
  agentLogs: Record<string, AgentLogEntry[]>;
  needsYou: NeedsYouItem[];
  handoffs: Handoff[];
}

/** Body of a 500 from /api/team (for example an invalid team.json). */
export interface TeamError {
  /** 'team': team.json is missing or invalid. 'server': any other failure of the office server. */
  kind: 'team' | 'server';
  error: string;
  hint: string;
}
