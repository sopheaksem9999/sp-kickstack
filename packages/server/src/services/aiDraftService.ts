import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { SettingsService } from './settingsService.js';
import type {
  ReasoningEffort,
  DraftRequirementResult,
  EngineRateLimitInfo,
  EngineProviderStatus,
} from '@sp-kickstack/shared';
export type { DraftRequirementResult, EngineRateLimitInfo, EngineProviderStatus };

export type AiProviderType =
  | 'auto'
  | 'heuristic'
  | 'claude-cli'
  | 'agy-cli'
  | 'codex-cli'
  | 'ollama'
  | 'anthropic'
  | 'openai';

export interface AiDraftOptions {
  provider?: AiProviderType;
  model?: string;
  effort?: ReasoningEffort;
  knownProjects?: string[];
  ollamaUrl?: string;
  apiKey?: string;
}

export type ProviderStatus = EngineProviderStatus;

export function findCliBinary(name: string): string | null {
  const home = process.env.HOME || '';
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
  const extraDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ];

  const allDirs = Array.from(new Set([...pathDirs, ...extraDirs]));

  for (const dir of allDirs) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.X_OK);
        fs.realpathSync(candidate);
        return candidate;
      }
    } catch {}
  }
  return null;
}

export class AiDraftService {
  private defaultOllamaUrl: string;
  private settingsService?: SettingsService;
  private db?: any;

  constructor(
    ollamaUrl: string = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    settingsService?: SettingsService,
    db?: any
  ) {
    this.defaultOllamaUrl = ollamaUrl;
    this.settingsService = settingsService;
    this.db = db;
  }

  public async getProviders(): Promise<EngineProviderStatus[]> {
    const cliSettings = this.settingsService?.getAiCliSettings();

    let totalDispatches = 0;
    let completedTasks = 0;
    let activeTasks = 0;
    let rateLimitEvents = 0;
    let maxPausedUntil: string | null = null;
    let lastUsedAt: string | null = null;

    if (this.db) {
      try {
        const stats = this.db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited,
            SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) as active,
            MAX(paused_until) as max_paused,
            MAX(created_at) as last_used
          FROM bridge_tasks
        `).get() as any;

        if (stats) {
          totalDispatches = Number(stats.total) || 0;
          completedTasks = Number(stats.completed) || 0;
          rateLimitEvents = Number(stats.rate_limited) || 0;
          activeTasks = Number(stats.active) || 0;
          maxPausedUntil = stats.max_paused || null;
          lastUsedAt = stats.last_used || null;
        }
      } catch {}
    }

    const isRateLimited = Boolean(maxPausedUntil && new Date(maxPausedUntil).getTime() > Date.now());

    // 1. Check Local Claude CLI
    const claudeBin = cliSettings?.claude?.customPath || findCliBinary('claude');
    const claudeInstalled = Boolean(claudeBin);
    const claudeAvailable = claudeInstalled && cliSettings?.claude?.enabled !== false;

    // 2. Check Local AGY CLI
    const agyBin = cliSettings?.agy?.customPath || findCliBinary('agy');
    const agyInstalled = Boolean(agyBin);
    const agyAvailable = agyInstalled && cliSettings?.agy?.enabled !== false;

    // 3. Check Local Codex CLI
    const codexBin = cliSettings?.codex?.customPath || findCliBinary('codex');
    const codexInstalled = Boolean(codexBin);
    const codexAvailable = codexInstalled && cliSettings?.codex?.enabled !== false;

    // 4. Check Ollama
    const ollamaUrl = cliSettings?.ollama?.url || this.defaultOllamaUrl;
    const ollamaBin = findCliBinary('ollama');
    let ollamaOnline = false;
    let ollamaModels: string[] = [];
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        ollamaModels = (data.models || []).map((m: any) => m.name || m.model);
        ollamaOnline = true;
      }
    } catch {}
    const ollamaInstalled = ollamaOnline || Boolean(ollamaBin);
    const ollamaAvailable = ollamaOnline && cliSettings?.ollama?.enabled !== false;

    const providers: EngineProviderStatus[] = [
      {
        id: 'claude-cli',
        name: 'Claude Code CLI',
        installed: claudeInstalled,
        available: claudeAvailable,
        path: claudeBin,
        note: claudeBin
          ? `Discovered at ${claudeBin} (Model: ${cliSettings?.claude?.model || 'sonnet-5'})`
          : 'Not detected on local PC (`npm i -g @anthropic-ai/claude-code`)',
        rateLimit: {
          supported: true,
          supportType: 'bridge_monitored',
          status: isRateLimited ? 'rate_limited' : 'healthy',
          pausedUntil: isRateLimited ? maxPausedUntil : null,
          message: isRateLimited
            ? `Engine rate limited; paused until ${maxPausedUntil}`
            : 'Bridge monitors 429 rate limit backoff (CLI does not expose local quota CLI)',
          totalDispatches,
          completedTasks,
          rateLimitEvents,
          activeTasks,
          lastUsedAt,
        },
      },
      {
        id: 'agy-cli',
        name: 'Antigravity CLI (agy)',
        installed: agyInstalled,
        available: agyAvailable,
        path: agyBin,
        note: agyBin
          ? `Discovered at ${agyBin} (Model: ${cliSettings?.agy?.model || 'gemini-3.8-flash'})`
          : 'Not detected on local PC (Google Antigravity CLI)',
        rateLimit: {
          supported: true,
          supportType: 'bridge_monitored',
          status: isRateLimited ? 'rate_limited' : 'healthy',
          pausedUntil: isRateLimited ? maxPausedUntil : null,
          message: isRateLimited
            ? `Engine rate limited; paused until ${maxPausedUntil}`
            : 'Bridge monitors RPM & quota backoff (AGY handles local session)',
          totalDispatches,
          completedTasks,
          rateLimitEvents,
          activeTasks,
          lastUsedAt,
        },
      },
      {
        id: 'codex-cli',
        name: 'Codex CLI',
        installed: codexInstalled,
        available: codexAvailable,
        path: codexBin,
        note: codexBin
          ? `Discovered at ${codexBin} (Model: ${cliSettings?.codex?.model || 'default'})`
          : 'Not detected on local PC (OpenAI Codex CLI)',
        rateLimit: {
          supported: true,
          supportType: 'bridge_monitored',
          status: isRateLimited ? 'rate_limited' : 'healthy',
          pausedUntil: isRateLimited ? maxPausedUntil : null,
          message: isRateLimited
            ? `Engine rate limited; paused until ${maxPausedUntil}`
            : 'Bridge monitors OpenAI rate limits and retry sweeper',
          totalDispatches,
          completedTasks,
          rateLimitEvents,
          activeTasks,
          lastUsedAt,
        },
      },
      {
        id: 'ollama',
        name: 'Local Ollama',
        installed: ollamaInstalled,
        available: ollamaAvailable,
        path: ollamaBin || ollamaUrl,
        models: ollamaModels,
        note: ollamaOnline
          ? `Connected at ${ollamaUrl} (${ollamaModels.length} models detected)`
          : ollamaBin
          ? `Binary discovered at ${ollamaBin} (Service not running on port 11434)`
          : `Not running at ${ollamaUrl} (https://ollama.ai)`,
        rateLimit: {
          supported: false,
          supportType: 'unlimited_offline',
          status: 'unlimited',
          message: 'Unlimited — Local hardware execution on your Mac (No remote API rate limits)',
          totalDispatches,
          completedTasks,
          rateLimitEvents: 0,
          activeTasks: 0,
          lastUsedAt,
        },
      },
      {
        id: 'heuristic',
        name: 'Built-in Heuristic Generator',
        installed: true,
        available: true,
        path: null,
        note: 'Zero-latency offline deterministic rules engine (100% offline, instant)',
        rateLimit: {
          supported: false,
          supportType: 'unlimited_offline',
          status: 'unlimited',
          message: 'Unlimited — 100% offline deterministic rules (Zero latency, no rate limits)',
          totalDispatches,
          completedTasks,
          rateLimitEvents: 0,
          activeTasks: 0,
          lastUsedAt,
        },
      },
    ];

    return providers;
  }

  public async draftRequirement(
    prompt: string,
    options: AiDraftOptions = {}
  ): Promise<DraftRequirementResult> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error('Prompt cannot be empty');
    }

    const cliSettings = this.settingsService?.getAiCliSettings();

    let provider = options.provider || 'auto';

    // Auto resolution honoring saved settings or favoring local CLIs
    if (provider === 'auto') {
      if (cliSettings?.defaultProvider && cliSettings.defaultProvider !== 'auto') {
        provider = cliSettings.defaultProvider;
      } else {
        const claudeBin = cliSettings?.claude?.customPath || findCliBinary('claude');
        const agyBin = cliSettings?.agy?.customPath || findCliBinary('agy');
        if (claudeBin && cliSettings?.claude?.enabled !== false) {
          provider = 'claude-cli';
        } else if (agyBin && cliSettings?.agy?.enabled !== false) {
          provider = 'agy-cli';
        } else {
          provider = 'heuristic';
        }
      }
    }

    // 1. Local Claude Code CLI
    if (provider === 'claude-cli') {
      const claudeBin = cliSettings?.claude?.customPath || findCliBinary('claude');
      if (claudeBin) {
        try {
          const mergedOptions: AiDraftOptions = {
            ...options,
            model: options.model || (cliSettings?.claude?.model ? cliSettings.claude.model : undefined),
            effort: options.effort || cliSettings?.claude?.effort,
          };
          return await this.draftWithClaudeCli(trimmed, mergedOptions, claudeBin);
        } catch (err) {
          const fallback = this.draftWithHeuristic(trimmed, options.knownProjects);
          return { ...fallback, provider_used: 'heuristic (fallback from claude-cli)' };
        }
      }
    }

    // 2. Local Antigravity CLI (agy)
    if (provider === 'agy-cli') {
      const agyBin = cliSettings?.agy?.customPath || findCliBinary('agy');
      if (agyBin) {
        try {
          const mergedOptions: AiDraftOptions = {
            ...options,
            model: options.model || (cliSettings?.agy?.model ? cliSettings.agy.model : undefined),
            effort: options.effort || cliSettings?.agy?.effort,
          };
          return await this.draftWithAgyCli(trimmed, mergedOptions, agyBin);
        } catch (err) {
          const fallback = this.draftWithHeuristic(trimmed, options.knownProjects);
          return { ...fallback, provider_used: 'heuristic (fallback from agy-cli)' };
        }
      }
    }

    // 3. Local Codex CLI
    if (provider === 'codex-cli') {
      const codexBin = cliSettings?.codex?.customPath || findCliBinary('codex');
      if (codexBin) {
        try {
          const mergedOptions: AiDraftOptions = {
            ...options,
            model: options.model || (cliSettings?.codex?.model ? cliSettings.codex.model : undefined),
            effort: options.effort || cliSettings?.codex?.effort,
          };
          return await this.draftWithCodexCli(trimmed, mergedOptions, codexBin);
        } catch (err) {
          const fallback = this.draftWithHeuristic(trimmed, options.knownProjects);
          return { ...fallback, provider_used: 'heuristic (fallback from codex-cli)' };
        }
      }
    }

    // 4. Local Ollama (Local models, no API key)
    if (provider === 'ollama') {
      try {
        const mergedOptions: AiDraftOptions = {
          ...options,
          model: options.model || cliSettings?.ollama?.model || 'llama3.2',
          ollamaUrl: options.ollamaUrl || cliSettings?.ollama?.url || this.defaultOllamaUrl,
        };
        return await this.draftWithOllama(trimmed, mergedOptions);
      } catch (err) {
        const fallback = this.draftWithHeuristic(trimmed, options.knownProjects);
        return { ...fallback, provider_used: 'heuristic (fallback from ollama)' };
      }
    }

    // 4. Cloud Anthropic API
    if (provider === 'anthropic' && (options.apiKey || process.env.ANTHROPIC_API_KEY)) {
      try {
        return await this.draftWithAnthropic(trimmed, options);
      } catch (err) {
        const fallback = this.draftWithHeuristic(trimmed, options.knownProjects);
        return { ...fallback, provider_used: 'heuristic (fallback from anthropic)' };
      }
    }

    // 5. Cloud OpenAI API
    if (provider === 'openai' && (options.apiKey || process.env.OPENAI_API_KEY)) {
      try {
        return await this.draftWithOpenAI(trimmed, options);
      } catch (err) {
        const fallback = this.draftWithHeuristic(trimmed, options.knownProjects);
        return { ...fallback, provider_used: 'heuristic (fallback from openai)' };
      }
    }

    // Fallback: Built-in Heuristic
    return this.draftWithHeuristic(trimmed, options.knownProjects);
  }

  private async draftWithClaudeCli(
    prompt: string,
    options: AiDraftOptions,
    binPath: string
  ): Promise<DraftRequirementResult> {
    const projects = (options.knownProjects || ['backend', 'frontend', 'mobile']).join(', ');
    const systemPrompt = `You are a software architect. Convert the user requirement into structured JSON matching this schema:
{
  "title": "Concise title",
  "goal": "Detailed description of feature goal",
  "user_story": "As a [role], I want [action], so that [benefit]",
  "acceptance_criteria": ["criterion 1", "criterion 2"],
  "affected_projects": ["project1"],
  "api_hints": "Optional API endpoint"
}
Available projects: ${projects}.
Respond ONLY with raw JSON, no markdown formatting.`;

    const fullPrompt = `${systemPrompt}\n\nRequirement:\n${prompt}`;
    const args = ['-p', fullPrompt, '--tools', ''];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    if (options.effort) {
      args.push('--effort', options.effort);
    }
    const cliSettings = this.settingsService?.getAiCliSettings();
    if (cliSettings?.claude?.ultracode) {
      args.push('--ultracode');
    }

    const result = await execa(binPath, args, {
      timeout: 30000,
      env: { ...process.env, CLAUDE_CODE_SAFE_MODE: '1' },
    });

    const parsed = this.parseJsonFromOutput(result.stdout);
    const modelTag = options.model ? ` (${options.model})` : '';
    const effortTag = options.effort ? ` [effort: ${options.effort}]` : '';

    return {
      title: parsed.title || 'Untitled Requirement',
      goal: parsed.goal || prompt,
      user_story: parsed.user_story || '',
      acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
        ? parsed.acceptance_criteria
        : ['Implementation complete and verified'],
      affected_projects: Array.isArray(parsed.affected_projects)
        ? parsed.affected_projects
        : ['backend'],
      api_hints: parsed.api_hints,
      provider_used: `Local Claude Code CLI${modelTag}${effortTag}`,
    };
  }

  private async draftWithAgyCli(
    prompt: string,
    options: AiDraftOptions,
    binPath: string
  ): Promise<DraftRequirementResult> {
    const projects = (options.knownProjects || ['backend', 'frontend', 'mobile']).join(', ');
    const systemPrompt = `Convert the requirement into JSON with fields title, goal, user_story, acceptance_criteria, affected_projects (from: ${projects}), api_hints. Output ONLY JSON.\n\nRequirement: ${prompt}`;

    const args = ['-p', systemPrompt, '--output-format', 'text'];
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.effort) {
      args.push('--effort', options.effort);
    }

    const result = await execa(binPath, args, {
      timeout: 30000,
    });

    const parsed = this.parseJsonFromOutput(result.stdout);
    const modelTag = options.model ? ` (${options.model})` : '';
    const effortTag = options.effort ? ` [effort: ${options.effort}]` : '';

    return {
      title: parsed.title || 'Untitled Requirement',
      goal: parsed.goal || prompt,
      user_story: parsed.user_story || '',
      acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
        ? parsed.acceptance_criteria
        : ['Implementation complete and verified'],
      affected_projects: Array.isArray(parsed.affected_projects)
        ? parsed.affected_projects
        : ['backend'],
        api_hints: parsed.api_hints,
        provider_used: `Local Antigravity CLI (agy)${modelTag}${effortTag}`,
      };
    }

    private async draftWithCodexCli(
      prompt: string,
      options: AiDraftOptions,
      binPath: string
    ): Promise<DraftRequirementResult> {
      const projects = (options.knownProjects || ['backend', 'frontend', 'mobile']).join(', ');
      const systemPrompt = `You are a software architect. Convert the requirement into JSON with fields title, goal, user_story, acceptance_criteria, affected_projects (from: ${projects}), api_hints. Output ONLY JSON.\n\nRequirement: ${prompt}`;

      const args = ['exec', systemPrompt];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }

      const result = await execa(binPath, args, {
        timeout: 30000,
      });

      const parsed = this.parseJsonFromOutput(result.stdout);
      const modelTag = options.model ? ` (${options.model})` : '';
      const effortTag = options.effort ? ` [effort: ${options.effort}]` : '';

      return {
        title: parsed.title || 'Untitled Requirement',
        goal: parsed.goal || prompt,
        user_story: parsed.user_story || '',
        acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
          ? parsed.acceptance_criteria
          : ['Implementation complete and verified'],
        affected_projects: Array.isArray(parsed.affected_projects)
          ? parsed.affected_projects
          : ['backend'],
        api_hints: parsed.api_hints,
        provider_used: `Local Codex CLI${modelTag}${effortTag}`,
      };
    }

    private parseJsonFromOutput(text: string): any {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonStr);
    }
    return JSON.parse(cleaned);
  }

  public draftWithHeuristic(
    prompt: string,
    knownProjects: string[] = ['backend', 'frontend', 'mobile']
  ): DraftRequirementResult {
    const lines = prompt.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] || 'New Feature Specification';

    // Format title
    let title = firstLine
      .replace(/^(we need|please add|create a|implement|build|add)\s+/i, '')
      .replace(/[.!?:;]+$/, '');
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.length > 70) {
      title = title.substring(0, 67) + '...';
    }

    // Detect affected projects
    const lower = prompt.toLowerCase();
    const affectedProjects: string[] = [];

    for (const p of knownProjects) {
      if (lower.includes(p.toLowerCase())) {
        affectedProjects.push(p);
      }
    }

    if (lower.includes('api') || lower.includes('endpoint') || lower.includes('database') || lower.includes('server')) {
      if (!affectedProjects.includes('backend') && knownProjects.includes('backend')) {
        affectedProjects.push('backend');
      }
    }

    if (lower.includes('ui') || lower.includes('screen') || lower.includes('modal') || lower.includes('view') || lower.includes('page') || lower.includes('web')) {
      if (!affectedProjects.includes('frontend') && knownProjects.includes('frontend')) {
        affectedProjects.push('frontend');
      }
    }

    if (lower.includes('ios') || lower.includes('android') || lower.includes('app') || lower.includes('mobile')) {
      if (!affectedProjects.includes('mobile') && knownProjects.includes('mobile')) {
        affectedProjects.push('mobile');
      }
    }

    // Default to at least the first project or backend
    if (affectedProjects.length === 0) {
      affectedProjects.push(knownProjects[0] || 'backend');
    }

    // Generate user story
    let userStory = `As a user, I want ${title.toLowerCase()} so that the application functions seamlessly.`;
    const userStoryMatch = prompt.match(/as a (.*?),? i want (.*?),? so that (.*)/i);
    if (userStoryMatch) {
      userStory = userStoryMatch[0];
    }

    // Generate Acceptance criteria
    const criteria: string[] = [];
    if (affectedProjects.includes('backend')) {
      criteria.push(`API endpoint and service implementation for ${title} complete and verified with automated tests`);
    }
    if (affectedProjects.includes('frontend') || affectedProjects.includes('mobile')) {
      criteria.push(`Interactive UI component and state handling for ${title} integrated and validated`);
    }
    criteria.push(`Validation rules and error boundary handling implemented`);
    criteria.push(`Cross-repo contract consistency and end-to-end integration verified`);

    // API hints
    let apiHints = '';
    if (lower.includes('auth') || lower.includes('login') || lower.includes('token')) {
      apiHints = 'POST /api/v1/auth - JWT bearer token authentication and rate limiting required';
    } else if (lower.includes('driver') || lower.includes('track') || lower.includes('realtime') || lower.includes('location')) {
      apiHints = 'WSS /api/v1/stream - WebSocket stream emitting event payload { timestamp, lat, lng, id }';
    } else {
      apiHints = `POST /api/v1/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }

    return {
      title,
      goal: prompt,
      user_story: userStory,
      acceptance_criteria: criteria,
      affected_projects: affectedProjects,
      api_hints: apiHints,
      provider_used: 'heuristic',
    };
  }

  private async draftWithOllama(
    prompt: string,
    options: AiDraftOptions
  ): Promise<DraftRequirementResult> {
    const url = options.ollamaUrl || this.defaultOllamaUrl;
    const model = options.model || 'llama3.2';

    const systemPrompt = `You are an expert software architect in SP-Kickstack. Convert the user's raw requirement into structured JSON matching this exact schema:
{
  "title": "Short concise title (under 60 chars)",
  "goal": "Detailed description of the goal",
  "user_story": "As a [role], I want [action], so that [benefit]",
  "acceptance_criteria": ["criterion 1", "criterion 2", "criterion 3"],
  "affected_projects": ["backend", "frontend"],
  "api_hints": "Optional API endpoint, format, or schema hints"
}
Available projects to choose from: ${(options.knownProjects || ['backend', 'frontend', 'mobile']).join(', ')}.
Respond with ONLY valid JSON, no markdown codeblocks.`;

    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${systemPrompt}\n\nUser requirement:\n${prompt}`,
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    const parsed = JSON.parse(data.response);

    return {
      title: parsed.title || 'Untitled Requirement',
      goal: parsed.goal || prompt,
      user_story: parsed.user_story || '',
      acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
        ? parsed.acceptance_criteria
        : ['Implementation complete and verified'],
      affected_projects: Array.isArray(parsed.affected_projects)
        ? parsed.affected_projects
        : ['backend'],
      api_hints: parsed.api_hints,
      provider_used: `ollama (${model})`,
    };
  }

  private async draftWithAnthropic(
    prompt: string,
    options: AiDraftOptions
  ): Promise<DraftRequirementResult> {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    const model = options.model || 'claude-3-5-sonnet-20241022';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Convert this software requirement into JSON with fields title, goal, user_story, acceptance_criteria (array), affected_projects (array from: ${(options.knownProjects || ['backend', 'frontend', 'mobile']).join(', ')}), api_hints. Return ONLY JSON.\n\nRequirement: ${prompt}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Anthropic API failed: ${res.status}`);
    const data = (await res.json()) as any;
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      title: parsed.title || 'Untitled Requirement',
      goal: parsed.goal || prompt,
      user_story: parsed.user_story || '',
      acceptance_criteria: parsed.acceptance_criteria || [],
      affected_projects: parsed.affected_projects || ['backend'],
      api_hints: parsed.api_hints,
      provider_used: `anthropic (${model})`,
    };
  }

  private async draftWithOpenAI(
    prompt: string,
    options: AiDraftOptions
  ): Promise<DraftRequirementResult> {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    const model = options.model || 'gpt-4o-mini';

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `Convert the user requirement into JSON with fields title, goal, user_story, acceptance_criteria (array), affected_projects (array from: ${(options.knownProjects || ['backend', 'frontend', 'mobile']).join(', ')}), api_hints. Respond with ONLY JSON.`,
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`OpenAI API failed: ${res.status}`);
    const data = (await res.json()) as any;
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    return {
      title: parsed.title || 'Untitled Requirement',
      goal: parsed.goal || prompt,
      user_story: parsed.user_story || '',
      acceptance_criteria: parsed.acceptance_criteria || [],
      affected_projects: parsed.affected_projects || ['backend'],
      api_hints: parsed.api_hints,
      provider_used: `openai (${model})`,
    };
  }
}
