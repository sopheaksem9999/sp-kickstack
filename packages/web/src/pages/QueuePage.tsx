export type QueueTab = 'all' | 'queued' | 'running' | 'failed' | 'done';
export const VALID_QUEUE_TABS: QueueTab[] = ['all', 'queued', 'running', 'failed', 'done'];

export function QueuePage() {
  return <div>Agent Queue</div>;
}
