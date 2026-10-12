import { Request, Response, NextFunction, RequestHandler } from 'express';

export const DEFAULT_WEB_ORIGINS = [
  'http://localhost:4101',
  'http://127.0.0.1:4101',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

export const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function fromEnvList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function resolveWebOrigins(env: string | undefined = process.env.WEB_ORIGINS): string[] {
  const configured = fromEnvList(env);
  return configured.length > 0 ? configured : DEFAULT_WEB_ORIGINS;
}

export function resolveAllowedHosts(env: string | undefined = process.env.ALLOWED_HOSTS): string[] {
  return [...DEFAULT_ALLOWED_HOSTS, ...fromEnvList(env)];
}

function hostname(hostHeader: string): string {
  if (hostHeader.startsWith('[')) {
    return hostHeader.slice(0, hostHeader.indexOf(']') + 1).toLowerCase();
  }
  return hostHeader.split(':')[0].toLowerCase();
}

/**
 * Blocks browser-driven cross-site requests (CSRF / drive-by from any web page the operator
 * visits) and DNS-rebinding attacks. Non-browser clients (agents, curl) send neither
 * Sec-Fetch-Site nor a foreign Host and pass through. Webhooks skip only the Host check
 * (they arrive through tunnels); GitHub never sends Sec-Fetch-Site, so browsers stay blocked.
 */
export function requestGuard(options: { webOrigins: string[]; allowedHosts: string[] }): RequestHandler {
  const origins = new Set(options.webOrigins);
  const hosts = new Set(options.allowedHosts.map((h) => h.toLowerCase()));

  return (req: Request, res: Response, next: NextFunction) => {
    const isWebhook = req.path.startsWith('/api/webhooks/');

    const host = req.headers.host;
    if (!isWebhook && host && !hosts.has(hostname(host))) {
      return res.status(403).json({ error: `Host not allowed: ${host}` });
    }

    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') {
      const origin = req.headers.origin;
      if (!origin || !origins.has(origin)) {
        return res.status(403).json({ error: 'Cross-site request blocked' });
      }
    }

    next();
  };
}
