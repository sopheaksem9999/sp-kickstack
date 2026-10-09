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
        }
      } catch (err) {}
    };

    return () => {
      es.close();
    };
  }, [queryClient]);
}
