import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@sp-kickstack/shared';

/** Shared /api/health query (also drives the offline badge in AppLayout). */
export const healthQueryOptions = {
  queryKey: ['health'],
  queryFn: async (): Promise<HealthResponse> => {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('Unhealthy');
    return res.json();
  },
  refetchInterval: 5000,
  retry: 1,
};

/** True when the server runs with DEMO_MODE=1 (simulated runner, demo merge). */
export function useDemoMode(): boolean {
  const { data } = useQuery(healthQueryOptions);
  return Boolean(data?.demo_mode);
}
