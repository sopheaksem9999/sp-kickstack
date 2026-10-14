import type { Express } from 'express';
import type { SseBroadcaster } from '../sse/broadcaster.js';
import type { AiChatToolsService } from '../aiChat/toolsService.js';

export interface AiChatToolsRouteDeps {
  tools: AiChatToolsService;
  broadcaster: SseBroadcaster;
}

/** Settings → AI Chat: MCP servers and skills for the AI chats. Secrets are never returned. */
export function registerAiChatToolsRoutes(app: Express, deps: AiChatToolsRouteDeps) {
  const { tools } = deps;
  const changed = () => deps.broadcaster.broadcast({ type: 'settings_updated', payload: { ai_chat_tools: true } });

  app.get('/api/ai-chat/tools', async (_req, res, next) => {
    try {
      res.json(await tools.view());
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/ai-chat/tools', async (req, res, next) => {
    try {
      tools.save(req.body ?? {});
      await tools.syncAgy();
      changed();
      res.json(await tools.view());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/servers/:name/test', async (req, res, next) => {
    try {
      res.json(await tools.testServer(req.params.name));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/import-mcp-json', async (req, res, next) => {
    try {
      const result = tools.importMcpJson(String(req.body?.json ?? ''));
      if (result.added.length) await tools.syncAgy();
      changed();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/import-skills', (req, res, next) => {
    try {
      const result = tools.importSkills(String(req.body?.folder ?? ''));
      changed();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/skills/:name/reimport', (req, res, next) => {
    try {
      res.json(tools.reimportSkill(req.params.name));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/agy-sync', async (_req, res, next) => {
    try {
      res.json(await tools.syncAgy());
    } catch (err) {
      next(err);
    }
  });
}
