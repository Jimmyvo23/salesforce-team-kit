import type { AgentStatus } from './types';

export type DeskState = 'working' | 'blocked' | 'waiting' | 'done' | 'free';

const DESK: Record<AgentStatus, DeskState> = {
  working: 'working', blocked: 'blocked', awaiting_approval: 'waiting', done: 'done', idle: 'free',
};

/** How a desk looks for an agent status (spec 8.2). */
export const deskState = (s: AgentStatus): DeskState => DESK[s];
