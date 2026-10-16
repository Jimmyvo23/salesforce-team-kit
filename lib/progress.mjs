// @ts-check
// Task progress for the dashboard: a percentage and a stage label worked out from events
// (spec 8.4a). It reflects where a task is in the pipeline and goes down when work is sent back.

/** Role ids the progress rules depend on. Every other member except the approver is a builder. */
export const ROLES = Object.freeze({ architect: 'planner', analyst: 'analyst', qa: 'qa', reviewer: 'reviewer' });
const NOT_BUILDERS = new Set([...Object.values(ROLES), 'team']);

/**
 * @param {string} id
 * @param {string} approverId
 * @returns {boolean}
 */
export const isBuilder = (id, approverId) => Boolean(id) && !NOT_BUILDERS.has(id) && id !== approverId;

/** @typedef {{ deployed: boolean, qaPassed: boolean, reviewed: boolean, back: boolean }} Track */

/** @returns {Track} */
export const emptyTrack = () => ({ deployed: false, qaPassed: false, reviewed: false, back: false });

/**
 * @param {{ id: string, state: string }} task
 * @param {{ approvals: { task: string|null, state: string }[], releases: { task: string, state: string }[], taskTrack: Record<string, Track> }} acc
 * @param {{ id: string, currentTask: string|null, progress: number }[]} agents
 * @param {string} approverId
 * @returns {{ progress: number, stage: string }}
 */
export function taskProgress(task, acc, agents, approverId) {
  const release = acc.releases.find((r) => r.task === task.id);
  if (release?.state === 'released') return { progress: 100, stage: 'Released' };
  if (task.state === 'done') return { progress: 100, stage: 'Done' };
  if (release?.state === 'ready') return { progress: 95, stage: 'Change set ready' };
  const t = acc.taskTrack[task.id] ?? emptyTrack();
  if (t.reviewed) return { progress: 90, stage: 'Review passed' };
  if (t.qaPassed) return { progress: 80, stage: 'QA passed' };
  if (t.deployed) return { progress: 65, stage: 'In sandbox' };
  const approvals = acc.approvals.filter((a) => a.task === task.id);
  if (approvals.length > 0 && approvals.every((a) => a.state === 'approved')) {
    const builders = agents.filter((a) => a.currentTask === task.id && isBuilder(a.id, approverId));
    const avg = builders.length === 0 ? 0 : builders.reduce((sum, a) => sum + a.progress, 0) / builders.length;
    return { progress: 30 + Math.round(avg * 0.3), stage: t.back ? 'Back to build' : 'Building' };
  }
  if (approvals.some((a) => a.state === 'pending')) return { progress: 20, stage: 'Waiting for approval' };
  return { progress: 5, stage: 'To do' };
}
