import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function useBridgeEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;

        // Invalidate queries to refresh view
        queryClient.invalidateQueries();

        if (data.type === 'task_status_changed') {
          toast.info(`Task status: ${data.payload?.newStatus} (${data.payload?.project})`);
        } else if (data.type === 'fanout_completed') {
          toast.success(`Fan-out dispatched for ${data.payload?.reqId}`);
        } else if (data.type === 'ticket_created') {
          toast.warning(`New cross-repo ticket to ${data.payload?.target}`);
        } else if (data.type === 'link_released') {
          toast.success(`Cross-repo dependency released!`);
        } else if (data.type === 'merge_succeeded') {
          const warnings: string[] = data.payload?.warnings ?? [];
          toast.success(`${data.payload?.reqId} merged and moved to QA`, {
            description: warnings.length ? warnings.join('\n') : undefined,
          });
        } else if (data.type === 'engine_rate_limited') {
          const until = data.payload?.until ? new Date(data.payload.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'later';
          toast.warning(`${data.payload?.project} engine is rate limited until ${until}; work resumes automatically`);
        } else if (data.type === 'task_rate_limited') {
          toast.info(`A ${data.payload?.project} task is paused by a rate limit; it resumes automatically`);
        } else if (data.type === 'merge_failed') {
          toast.error(`Merge failed for ${data.payload?.reqId}`, {
            description: String(data.payload?.error ?? '').split('\n')[0],
          });
        }
      } catch (err) {}
    };

    return () => {
      es.close();
    };
  }, [queryClient]);
}
