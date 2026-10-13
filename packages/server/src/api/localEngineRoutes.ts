import type { Express } from 'express';
import type { LocalEngineStatus } from '@sp-kickstack/shared';
import type { SettingsService } from '../services/settingsService.js';
import type { SseBroadcaster } from '../sse/broadcaster.js';

export interface LocalEngineRouteDeps {
  settingsService: SettingsService;
  broadcaster: SseBroadcaster;
  localEngine?: { status(): LocalEngineStatus; nudge(): void };
}

/** Settings → AI & Local Engines: the Local AI CLI engine's settings and live status. */
export function registerLocalEngineRoutes(app: Express, deps: LocalEngineRouteDeps) {
  app.get('/api/settings/local-engine', (_req, res) => {
    res.json(deps.settingsService.getLocalEngineSettings());
  });

  app.put('/api/settings/local-engine', (req, res, next) => {
    try {
      const updated = deps.settingsService.updateLocalEngineSettings(req.body);
      deps.broadcaster.broadcast({ type: 'settings_updated', payload: { local_engine: updated } });
      deps.localEngine?.nudge();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/local-engine/status', (_req, res) => {
    if (!deps.localEngine) return res.status(503).json({ error: 'The Local AI CLI engine is not running in this server' });
    res.json(deps.localEngine.status());
  });
}
