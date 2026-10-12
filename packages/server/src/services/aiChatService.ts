import crypto from 'node:crypto';
import { execa } from 'execa';
import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { SettingsService } from './settingsService.js';
import { RequirementService } from './requirementService.js';
import { findCliBinary } from './aiDraftService.js';
import {
  AiChatMessage,
  AiChatRequest,
  AiChatResponse,
  AiChatSession,
  DraftRequirementResult,
  ChatAttachmentItem,
  AttachmentItem,
  Requirement,
  normalizeMergePolicy,
} from '@sp-kickstack/shared';

export class AiChatService {
  private requirementService: RequirementService;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private settingsService?: SettingsService,
    requirementService?: RequirementService
  ) {
    this.requirementService = requirementService || new RequirementService(this.db);
  }

  public listSessions(workspaceId?: string): AiChatSession[] {
    const ws = workspaceId || 'default';
    const rows = this.db
      .prepare('SELECT * FROM ai_chat_sessions WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(ws) as any[];

    return rows.map((r) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      title: r.title,
      provider: r.provider,
      model: r.model || undefined,
      effort: r.effort || 'medium',
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  public createSession(input: {
    workspace_id?: string;
    title?: string;
    provider?: any;
    model?: string;
    effort?: any;
  }): AiChatSession {
    const id = `chat-${crypto.randomUUID()}`;
    const workspaceId = input.workspace_id || 'default';
    const title = input.title || 'New Architecture Discussion';
    const provider = input.provider || 'auto';
    const effort = input.effort || 'medium';
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO ai_chat_sessions (id, workspace_id, title, provider, model, effort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workspaceId, title, provider, input.model || null, effort, now, now);

    const welcomeId = `msg-${crypto.randomUUID()}`;
    const projects = this.projectService.listProjects(workspaceId).map((p) => p.name);
    const welcomeContent = `👋 Hello! I am your **Local AI Principal Architect** running locally on your Mac with **Zero Cloud API Keys**.

Workspace Stack & Repositories:
- **${projects.length > 0 ? projects.join(', ') : 'backend, frontend'}**
- Target Base Branch: **develop**
- Target Policy: **Contract-isolated multi-repo fan-out**

What feature, solution, or refactoring would you like to design today? Tell me what you'd like to build and we will architect the multi-repo requirement together!`;

    this.db
      .prepare(
        `INSERT INTO ai_chat_messages (id, session_id, role, content, spec_json, attachments, created_at)
         VALUES (?, ?, 'assistant', ?, null, '[]', ?)`
      )
      .run(welcomeId, id, welcomeContent, now);

    return {
      id,
      workspace_id: workspaceId,
      title,
      provider,
      model: input.model,
      effort,
      created_at: now,
      updated_at: now,
      messages: [
        {
          id: welcomeId,
          role: 'assistant',
          content: welcomeContent,
          timestamp: now,
          attachments: [],
        },
      ],
    };
  }

  public getSession(sessionId: string): AiChatSession | null {
    const row = this.db
      .prepare('SELECT * FROM ai_chat_sessions WHERE id = ?')
      .get(sessionId) as any;
    if (!row) return null;

    const messageRows = this.db
      .prepare('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as any[];

    const messages: AiChatMessage[] = messageRows.map((m) => {
      let suggestedSpec: DraftRequirementResult | undefined = undefined;
      if (m.spec_json) {
        try {
          suggestedSpec = JSON.parse(m.spec_json);
        } catch {}
      }
      let attachments: ChatAttachmentItem[] | undefined = undefined;
      if (m.attachments) {
        try {
          const parsed = JSON.parse(m.attachments);
          if (Array.isArray(parsed) && parsed.length > 0) {
            attachments = parsed;
          }
        } catch {}
      }
      return {
        id: m.id,
        role: m.role as any,
        content: m.content,
        timestamp: m.created_at,
        suggested_spec: suggestedSpec,
        attachments,
      };
    });

    return {
      id: row.id,
      workspace_id: row.workspace_id,
      title: row.title,
      provider: row.provider,
      model: row.model || undefined,
      effort: row.effort || 'medium',
      created_at: row.created_at,
      updated_at: row.updated_at,
      messages,
    };
  }

  public updateSession(
    sessionId: string,
    input: {
      title?: string;
      provider?: any;
      model?: string;
      effort?: any;
    }
  ): AiChatSession | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const newTitle = input.title !== undefined ? input.title : session.title;
    const newProvider = input.provider !== undefined ? input.provider : session.provider;
    const newModel = input.model !== undefined ? input.model : (session.model || null);
    const newEffort = input.effort !== undefined ? input.effort : (session.effort || 'medium');
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE ai_chat_sessions
         SET title = ?, provider = ?, model = ?, effort = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(newTitle, newProvider, newModel, newEffort, now, sessionId);

    return this.getSession(sessionId);
  }

  public deleteSession(sessionId: string): boolean {
    this.db.prepare('DELETE FROM ai_chat_messages WHERE session_id = ?').run(sessionId);
    const info = this.db.prepare('DELETE FROM ai_chat_sessions WHERE id = ?').run(sessionId);
    return info.changes > 0;
  }

  public async sendSessionMessage(
    sessionId: string,
    input: {
      content: string;
      provider?: any;
      model?: string;
      effort?: any;
      attachments?: ChatAttachmentItem[];
    }
  ): Promise<{ session: AiChatSession; message: AiChatMessage; suggested_spec?: DraftRequirementResult }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session ${sessionId} not found`);
    }

    const now = new Date().toISOString();
    const userMsgId = `msg-${crypto.randomUUID()}`;

    // 1. Record user message with attachments
    this.db
      .prepare(
        `INSERT INTO ai_chat_messages (id, session_id, role, content, spec_json, attachments, created_at)
         VALUES (?, ?, 'user', ?, null, ?, ?)`
      )
      .run(userMsgId, sessionId, input.content, JSON.stringify(input.attachments || []), now);

    const userMsg: AiChatMessage = {
      id: userMsgId,
      role: 'user',
      content: input.content,
      timestamp: now,
      attachments: input.attachments,
    };

    const currentHistory = [...(session.messages || []), userMsg];

    // 2. Chat with local AI using session continuity
    const chatReq: AiChatRequest = {
      messages: currentHistory,
      provider: input.provider || session.provider,
      model: input.model || session.model,
      effort: input.effort || session.effort || 'medium',
      workspace_id: session.workspace_id,
    };

    const response = await this.chat(chatReq, sessionId);

    // 3. Record assistant message
    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const specJson = response.suggested_spec ? JSON.stringify(response.suggested_spec) : null;

    this.db
      .prepare(
        `INSERT INTO ai_chat_messages (id, session_id, role, content, spec_json, attachments, created_at)
         VALUES (?, ?, 'assistant', ?, ?, '[]', ?)`
      )
      .run(assistantMsgId, sessionId, response.message.content, specJson, now);

    // 4. Update session title if default
    let newTitle = session.title;
    if (session.title === 'New Architecture Discussion' && input.content.trim()) {
      newTitle = input.content.length > 35 ? input.content.slice(0, 32) + '...' : input.content;
      this.db
        .prepare('UPDATE ai_chat_sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(newTitle, now, sessionId);
    } else {
      this.db
        .prepare('UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?')
        .run(now, sessionId);
    }

    const updatedSession = this.getSession(sessionId)!;
    return {
      session: updatedSession,
      message: {
        id: assistantMsgId,
        role: 'assistant',
        content: response.message.content,
        timestamp: now,
        suggested_spec: response.suggested_spec,
      },
      suggested_spec: response.suggested_spec,
    };
  }

  public async createRequirementFromSession(
    sessionId: string,
    extraInstructions?: string
  ): Promise<{
    requirement: Requirement;
    session: AiChatSession;
  }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session ${sessionId} not found`);
    }

    if (!session.messages || session.messages.length === 0) {
      throw new Error('Cannot create requirement from empty chat session. Please discuss your feature requirements first.');
    }

    // 1. Gather all attachments across the entire session
    const sessionAttachments: AttachmentItem[] = [];
    for (const msg of session.messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (!sessionAttachments.some((a) => a.name === att.name)) {
            sessionAttachments.push({
              name: att.name,
              type: att.type,
              size: att.size,
              data_url: att.data_url,
            });
          }
        }
      }
    }

    // 2. Request AI to synthesize the entire conversation into a comprehensive requirement specification
    const synthesisPrompt = `You are the Principal Software Architect for this multi-project workspace.
Analyze the ENTIRE conversation history below between Developer and Architect.
Synthesize all user requests, architectural designs, contracts, acceptance criteria, constraints, and edge cases discussed into a comprehensive, production-ready Requirement Ticket Specification.

${this.compileWorkspaceContext(session.workspace_id)}

Guidelines:
1. Title: Concise, clear architectural feature title.
2. Goal: Comprehensive business and technical goal synthesized from all discussion points.
3. User Story: "As a [role], I want [capability], so that [business value]."
4. Acceptance Criteria: An exhaustive list of ALL criteria, verification checks, edge cases, test requirements, and contracts agreed upon in this chat.
5. Affected Projects: List all workspace project repositories that need code changes.
6. API Hints: Document all API paths, payload schemas, query parameters, or contract definitions discussed.
7. Notes: Detailed architectural summary and record of key decisions made in this discussion.
${extraInstructions ? `8. Additional Developer Instructions: "${extraInstructions}"` : ''}

You MUST return your specification strictly in a \`\`\`json:spec block:
\`\`\`json:spec
{
  "title": "Title here",
  "goal": "Detailed goal here",
  "user_story": "As a ...",
  "acceptance_criteria": [
    "Criterion 1",
    "Criterion 2"
  ],
  "affected_projects": ["backend", "frontend"],
  "api_hints": "POST /api/v1/...",
  "notes": "Architectural summary and decisions..."
}
\`\`\`
`;

    const chatReq: AiChatRequest = {
      messages: [
        ...session.messages,
        {
          id: `msg-${crypto.randomUUID()}`,
          role: 'user',
          content: synthesisPrompt,
          timestamp: new Date().toISOString(),
        },
      ],
      provider: session.provider,
      model: session.model,
      effort: 'high',
      workspace_id: session.workspace_id,
    };

    const aiResponse = await this.chat(chatReq, sessionId);
    let spec = aiResponse.suggested_spec;

    if (!spec) {
      // Also check if aiResponse.message.content contains embedded spec
      spec = this.extractSpecFromContent(aiResponse.message.content);
    }

    if (!spec) {
      const latestWithSpec = [...session.messages].reverse().find((m) => m.suggested_spec)?.suggested_spec;
      if (latestWithSpec) {
        spec = latestWithSpec;
      }
    }

    // Extract rich architecture directly from the session discussion
    const availableProjects = this.projectService.listProjects(session.workspace_id).map((p) => p.name);
    const extractedArchitecture = this.extractRichArchitectureFromMessages(
      session.messages,
      session.title,
      availableProjects
    );

    // If spec is still null or has generic titles/criteria, use extractedArchitecture
    if (!spec) {
      spec = extractedArchitecture;
    } else {
      // If spec title is generic (e.g. starts with "Requirement created:" or "Architectural Feature Requirement"), upgrade it
      if (
        !spec.title ||
        spec.title === 'Architectural Feature Requirement' ||
        spec.title.startsWith('Requirement created:') ||
        spec.title.startsWith('what is your recommend')
      ) {
        spec.title = extractedArchitecture.title;
      }
      if (!spec.goal || spec.goal.startsWith('Implement Requirement created:')) {
        spec.goal = extractedArchitecture.goal;
      }
      // Merge acceptance criteria if spec had few items
      if (!spec.acceptance_criteria || spec.acceptance_criteria.length <= 1) {
        spec.acceptance_criteria = extractedArchitecture.acceptance_criteria;
      }
      if (!spec.affected_projects || spec.affected_projects.length === 0) {
        spec.affected_projects = extractedArchitecture.affected_projects;
      }
      if (!spec.api_hints && extractedArchitecture.api_hints) {
        spec.api_hints = extractedArchitecture.api_hints;
      }
    }

    // Ensure notes has the COMPLETE architectural markdown from the conversation
    const chatArchitecturalDoc = session.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => this.stripSpecJsonFromContent(m.content))
      .filter((text) => text.length > 50)
      .join('\n\n---\n\n');

    const synthesisText = this.stripSpecJsonFromContent(aiResponse.message?.content || '');

    const detailedArchitecture = [
      chatArchitecturalDoc || spec.notes || extractedArchitecture.notes || '',
      synthesisText && !chatArchitecturalDoc.includes(synthesisText.slice(0, 50))
        ? `\n### Synthesized Architecture Overview:\n${synthesisText}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    // 3. Compile full discussion record into notes
    const discussionNotes = [
      `### Architectural Assessment & Technical Details\n`,
      detailedArchitecture,
      `\n---`,
      `### AI Architecture Discussion Context`,
      `* **Chat Session**: "${session.title}" (\`${session.id}\`)`,
      `* **Engine Used**: ${aiResponse.provider_used || session.provider}`,
      `* **Synthesized At**: ${new Date().toLocaleString()}`,
      extraInstructions ? `* **Developer Instructions**: "${extraInstructions}"` : '',
      spec.api_hints ? `* **API & Contract Hints**: \`${spec.api_hints}\`` : '',
    ]
      .filter(Boolean)
      .join('\n');

    // 4. Create the requirement in database & disk
    const createdRequirement = this.requirementService.createRequirement({
      workspace_id: session.workspace_id,
      session_id: session.id,
      title: spec.title || session.title || 'Architectural Requirement',
      goal: spec.goal || `Implement architecture discussed in session "${session.title}"`,
      user_story: spec.user_story,
      acceptance_criteria:
        spec.acceptance_criteria && spec.acceptance_criteria.length > 0
          ? spec.acceptance_criteria
          : ['Implementation complete and verified with tests'],
      // Only this workspace's repositories, whatever the AI suggested.
      affected_projects: (() => {
        const chosen = (spec.affected_projects || []).filter((p) => availableProjects.includes(p));
        return chosen.length > 0 ? chosen : availableProjects.slice(0, 2);
      })(),
      api_hints: spec.api_hints,
      notes: discussionNotes,
      attachments: sessionAttachments,
      priority: 'high',
      status: 'draft',
    });

    // 5. Append assistant confirmation message to session transcript
    const now = new Date().toISOString();
    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const confirmContent = `🎯 **Ticket Created from Full Discussion Context**: [#${createdRequirement.id} - ${createdRequirement.title}](/requirements/${createdRequirement.id})

**Synthesized Scope:**
- **Affected Projects**: \`${createdRequirement.affected_projects.join(', ')}\`
- **Acceptance Criteria**: ${spec.acceptance_criteria?.length || 0} items synthesized from conversation
- **Attachments Attached**: ${sessionAttachments.length} file(s)
${spec.api_hints ? `- **API / Contract**: \`${spec.api_hints}\`\n` : ''}

You can click **Open Info** on ticket #${createdRequirement.id} in the right sidebar or reference it in chat with **#${createdRequirement.id}**.`;

    this.db
      .prepare(
        `INSERT INTO ai_chat_messages (id, session_id, role, content, spec_json, attachments, created_at)
         VALUES (?, ?, 'assistant', ?, ?, '[]', ?)`
      )
      .run(assistantMsgId, sessionId, confirmContent, JSON.stringify(spec), now);

    this.db
      .prepare('UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?')
      .run(now, sessionId);

    return {
      requirement: createdRequirement,
      session: this.getSession(sessionId)!,
    };
  }

  /** Context for the AI architect: the projects of one workspace only (all workspaces when none is given). */
  public compileWorkspaceContext(workspaceId?: string): string {
    const projects = this.projectService.listProjects(workspaceId);
    const projLines = projects.map(
      (p) => `- **${p.name}** (kind: \`${p.kind}\`, repo: \`${p.repo_path}\`, base_branch: \`${p.base_branch || 'develop'}\`, engine: \`${p.engine_type}\`)`
    );

    let branchPolicy = 'Target develop branch; manual review before merge to main.';
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'branch_merge_settings'").get() as any;
      if (row?.value) {
        const parsed = JSON.parse(row.value);
        if (normalizeMergePolicy(parsed.merge_policy) === 'auto_merge') {
          branchPolicy = 'Target develop branch; auto-merge to main on task completion & green tests.';
        }
      }
    } catch {}

    const assets = this.db
      .prepare('SELECT name, type, notes FROM shared_assets LIMIT 10')
      .all() as Array<{ name: string; type: string; notes?: string }>;
    const assetLines = assets.map((a) => `- ${a.name} (${a.type})${a.notes ? `: ${a.notes}` : ''}`);

    let reqLines: string[] = [];
    try {
      const reqs = this.db
        .prepare('SELECT id, title, status, priority FROM requirements ORDER BY seq DESC LIMIT 15')
        .all() as Array<{ id: string; title: string; status: string; priority: string }>;
      reqLines = reqs.map((r) => `- #${r.id}: **${r.title}** [status: ${r.status}, priority: ${r.priority}]`);
    } catch {}

    return `## SP-Kickstack Workspace Context
### Registered Projects & Stack:
${projLines.length > 0 ? projLines.join('\n') : 'No projects registered yet.'}

### Workspace Branch & Merge Policy:
${branchPolicy}
${assetLines.length > 0 ? `\n### Shared Contracts & Assets:\n${assetLines.join('\n')}` : ''}
${reqLines.length > 0 ? `\n### Existing Workspace Requirements / Tickets (referenceable via #ID):\n${reqLines.join('\n')}` : ''}
`;
  }

  public stripSpecJsonFromContent(rawText: string): string {
    return rawText
      .replace(/```(?:json:spec)\s*[\s\S]*?```/gi, '')
      .replace(/```json\s*\{[\s\S]*?"(?:title|goal)"[\s\S]*?\}\s*```/gi, '')
      .replace(/^I reviewed your requirement for:?[^\n]*\n+/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  public extractSpecFromContent(rawText: string): DraftRequirementResult | undefined {
    // 1. Look for ```json:spec ... ``` or ```json ... ```
    const specBlockMatch = rawText.match(/```(?:json:spec|json)\s*([\s\S]*?)```/i);
    const jsonCandidate = specBlockMatch ? specBlockMatch[1].trim() : null;

    if (!jsonCandidate) return undefined;

    try {
      const parsed = JSON.parse(jsonCandidate);
      if (parsed.title || parsed.goal) {
        return {
          title: parsed.title || 'Untitled Requirement',
          goal: parsed.goal || '',
          user_story: parsed.user_story || '',
          acceptance_criteria: Array.isArray(parsed.acceptance_criteria)
            ? parsed.acceptance_criteria
            : [],
          affected_projects: Array.isArray(parsed.affected_projects)
            ? parsed.affected_projects
            : [],
          api_hints: parsed.api_hints || undefined,
          provider_used: 'Local AI Architect',
        };
      }
    } catch {}

    return undefined;
  }

  public extractRichArchitectureFromMessages(
    messages: AiChatMessage[],
    sessionTitle?: string,
    availableProjects: string[] = []
  ): DraftRequirementResult {
    const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content.trim().length > 0);
    const userMessages = messages.filter((m) => m.role === 'user' && m.content.trim().length > 0);

    // Pick the most comprehensive architectural message
    let bestMsg = assistantMessages[assistantMessages.length - 1];
    for (let i = assistantMessages.length - 1; i >= 0; i--) {
      const content = assistantMessages[i].content;
      if (
        content.includes('Architectural Assessment') ||
        content.includes('CREATE TABLE') ||
        content.includes('Database Schema') ||
        content.includes('### 1.')
      ) {
        bestMsg = assistantMessages[i];
        break;
      }
    }

    const rawContent = bestMsg?.content || '';

    // Extract Title: Look for "### Architectural Assessment: <Title>" or "#+ <Title>"
    let title = '';
    const headingMatch = rawContent.match(/^#{1,3}\s*(?:Architectural\s*(?:Assessment|Specification|Design|Proposal)[:\s]+)?([^\n]+)/im);
    if (headingMatch && headingMatch[1].trim()) {
      title = headingMatch[1]
        .replace(/[`*#]/g, '')
        .replace(/^Architectural\s*(?:Assessment|Specification|Design|Proposal)[:\s]+/i, '')
        .trim();
    }

    // If title is missing or is a prompt echo / generic title, resolve cleanly
    const isGenericTitle =
      !title ||
      title.toLowerCase().startsWith('requirement created:') ||
      title.toLowerCase().startsWith('what is your recommend') ||
      title.toLowerCase() === 'new architecture discussion' ||
      title.length < 4;

    if (isGenericTitle) {
      if (
        sessionTitle &&
        !sessionTitle.toLowerCase().startsWith('requirement created:') &&
        sessionTitle !== 'New Architecture Discussion' &&
        sessionTitle !== 'hi' &&
        sessionTitle.length > 3
      ) {
        title = sessionTitle;
      } else {
        const relevantUser = userMessages.find(
          (u) =>
            !u.content.toLowerCase().startsWith('requirement created:') &&
            !u.content.toLowerCase().startsWith('create ticket') &&
            u.content.trim().length > 5
        );
        if (relevantUser) {
          title = relevantUser.content.trim();
          if (title.length > 50) title = title.slice(0, 47) + '...';
        } else {
          title = 'Architectural Feature Specification';
        }
      }
    }

    // Extract Goal: The introductory paragraph under the title
    let goal = '';
    const lines = rawContent.split('\n');
    let foundHeading = false;
    const goalParagraphs: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        if (!foundHeading) {
          foundHeading = true;
          continue;
        } else {
          break;
        }
      }
      if (foundHeading && trimmed && !trimmed.startsWith('---') && !trimmed.startsWith('```')) {
        goalParagraphs.push(trimmed);
      }
    }
    if (goalParagraphs.length > 0) {
      goal = goalParagraphs.join(' ');
    } else {
      goal = `Implement ${title} according to the architectural design and contracts agreed in chat.`;
    }

    // Extract User Story
    const storyMatch = rawContent.match(/As a\s+([^,]+),\s*I want\s+([^,]+),\s*so that\s+([^.\n]+)/i);
    const userStory = storyMatch
      ? `As a ${storyMatch[1].trim()}, I want ${storyMatch[2].trim()}, so that ${storyMatch[3].trim()}.`
      : `As a developer, I want to implement ${title}, so that the system operates reliably across affected services.`;

    // Extract Acceptance Criteria:
    const criteria: string[] = [];

    // Look for SQL CREATE TABLE statements
    const tableMatches = [...rawContent.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi)];
    if (tableMatches.length > 0) {
      const tableNames = Array.from(new Set(tableMatches.map((m) => m[1])));
      criteria.push(`Create and migrate database tables: ${tableNames.map((t) => `\`${t}\``).join(', ')} with relational integrity and constraints`);
    }

    // Look for specific approaches or constraints
    if (rawContent.includes('Approach A') || rawContent.includes('Dedicated Translation Tables')) {
      criteria.push('Implement dedicated translation tables with compound unique constraint on `(entity_id, locale)`');
    }
    if (rawContent.includes('Accept-Language') || rawContent.includes('locale') || rawContent.includes('Content Negotiation')) {
      criteria.push('Support locale negotiation via `Accept-Language` header and `?locale` parameter with fallback to default locale');
      criteria.push('Implement client localized response shape and Admin CMS payload for managing all locales');
    }

    // Scan for markdown bullet points that look like criteria
    const bulletMatches = rawContent.match(/^[-*]\s+\*\*([^*]+)\*\*:\s*([^\n]+)/gm);
    if (bulletMatches) {
      for (const bm of bulletMatches.slice(0, 3)) {
        const cleaned = bm.replace(/^[-*]\s+/, '').trim();
        if (!criteria.some((c) => c.includes(cleaned.slice(0, 15)))) {
          criteria.push(cleaned);
        }
      }
    }

    // Always include verification criteria
    if (!criteria.some((c) => c.includes('tests'))) {
      criteria.push('Unit and integration tests pass on develop branch');
    }

    // Extract Affected Projects
    const affectedProjects: string[] = [];
    const lowerContent = rawContent.toLowerCase();
    for (const proj of availableProjects) {
      const lowerProj = proj.toLowerCase();
      if (lowerContent.includes(lowerProj)) {
        affectedProjects.push(proj);
      }
    }
    if (affectedProjects.length === 0) {
      if (lowerContent.includes('api')) affectedProjects.push('api');
      if (lowerContent.includes('admin') || lowerContent.includes('dashboard')) affectedProjects.push('admin dashboard');
      if (affectedProjects.length === 0) {
        affectedProjects.push(...availableProjects.slice(0, 2));
      }
    }

    // Extract API Hints
    let apiHints: string | undefined;
    const apiMatch = rawContent.match(/(?:Accept-Language[^\n]*|GET\s+\/[^\n]*|POST\s+\/[^\n]*|\?locale=[^\n]*)/i);
    if (apiMatch) {
      apiHints = apiMatch[0].trim();
    }

    return {
      title,
      goal,
      user_story: userStory,
      acceptance_criteria: criteria.length > 0 ? criteria : ['Implementation complete and verified with tests'],
      affected_projects: affectedProjects,
      api_hints: apiHints,
      notes: rawContent,
      provider_used: bestMsg ? 'Chat Conversation' : 'Local Architect',
    };
  }

  public async chat(req: AiChatRequest, sessionId?: string): Promise<AiChatResponse> {
    const cliSettings = this.settingsService?.getAiCliSettings();
    let provider = req.provider || cliSettings?.defaultProvider || 'auto';

    if (provider === 'auto') {
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

    const workspaceContext = this.compileWorkspaceContext(req.workspace_id);
    const systemPrompt = `You are the Principal Software Architect for this multi-project workspace.
You collaborate with the developer to design, clarify, and formulate feature requirements.
You know the local workspace stack, repositories, and branch policies.

${workspaceContext}

Guidelines:
1. Provide concise, expert architectural guidance, considering affected repos, API contracts, and edge cases.
2. Directly answer the question or provide architectural designs. Do NOT repeat or echo back the user's prompt or requirement (e.g. avoid repeating "I reviewed your requirement for: ..."). Jump straight into the architectural solution, schema, or response.
3. When the user references tickets or requirements with #ID (e.g. #REQ-001 or #CG-001), consult the existing workspace ticket from context, discuss changes, or formulate connected specs accordingly.
4. When formulating a feature requirement, embed a structured JSON block inside your reply using \`\`\`json:spec:
\`\`\`json:spec
{
  "title": "Concise Feature Title",
  "goal": "Detailed description of feature goal",
  "user_story": "As a [role], I want [action], so that [benefit]",
  "acceptance_criteria": ["Criterion 1", "Criterion 2"],
  "affected_projects": ["backend", "frontend"],
  "api_hints": "POST /api/..."
}
\`\`\`
`;

    // 1. Try Claude CLI with session continuity
    if (provider === 'claude-cli') {
      const claudeBin = cliSettings?.claude?.customPath || findCliBinary('claude');
      if (claudeBin) {
        try {
          return await this.chatWithClaudeCli(req, systemPrompt, claudeBin, cliSettings, sessionId);
        } catch {
          // Fall back to heuristic
        }
      }
    }

    // 2. Try Agy CLI with session continuity
    if (provider === 'agy-cli') {
      const agyBin = cliSettings?.agy?.customPath || findCliBinary('agy');
      if (agyBin) {
        try {
          return await this.chatWithAgyCli(req, systemPrompt, agyBin, cliSettings, sessionId);
        } catch {
          // Fall back to heuristic
        }
      }
    }

    // 3. Fallback Heuristic Architect
    return this.chatWithHeuristic(req);
  }

  private formatTranscript(messages: AiChatMessage[]): string {
    return messages
      .map((m) => {
        let text = `${m.role === 'user' ? 'Developer' : 'Architect'}: ${m.content}`;
        if (m.attachments && m.attachments.length > 0) {
          text += `\n[Attached Files: ${m.attachments.map((a) => a.name).join(', ')}]`;
          for (const att of m.attachments) {
            if (
              att.data_url &&
              (att.type?.startsWith('text/') ||
                att.name.match(/\.(json|sql|ts|tsx|js|jsx|md|txt|yaml|yml|css|html)$/i))
            ) {
              try {
                if (att.data_url.startsWith('data:')) {
                  const base64Part = att.data_url.split(',')[1];
                  if (base64Part) {
                    const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
                    text += `\n\`\`\`${att.name}\n${decoded.slice(0, 3000)}\n\`\`\``;
                  }
                }
              } catch {}
            }
          }
        }
        return text;
      })
      .join('\n\n');
  }

  private async chatWithClaudeCli(
    req: AiChatRequest,
    systemPrompt: string,
    binPath: string,
    cliSettings: any,
    sessionId?: string
  ): Promise<AiChatResponse> {
    const model = req.model || cliSettings?.claude?.model || 'claude-3-7-sonnet';
    const effort = req.effort || cliSettings?.claude?.effort || 'medium';

    // Build conversation transcript for CLI prompt with attachment contents
    const conversationTranscript = this.formatTranscript(req.messages);

    const fullPrompt = `${systemPrompt}\n\n## Conversation History:\n${conversationTranscript}\n\nArchitect:`;

    const args = ['-p', fullPrompt, '--tools', ''];
    if (sessionId) {
      args.push('--session-id', sessionId);
    }
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);

    const result = await execa(binPath, args, {
      timeout: 35000,
      env: { ...process.env, CLAUDE_CODE_SAFE_MODE: '1' },
    });

    const assistantText = result.stdout.trim();
    const suggestedSpec = this.extractSpecFromContent(assistantText);
    const cleanContent = this.stripSpecJsonFromContent(assistantText) || assistantText;

    return {
      message: {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: cleanContent,
        timestamp: new Date().toISOString(),
        suggested_spec: suggestedSpec,
      },
      suggested_spec: suggestedSpec,
      provider_used: `Local Claude Code CLI (${model}) [effort: ${effort}]`,
    };
  }

  private async chatWithAgyCli(
    req: AiChatRequest,
    systemPrompt: string,
    binPath: string,
    cliSettings: any,
    sessionId?: string
  ): Promise<AiChatResponse> {
    const model = req.model || cliSettings?.agy?.model || 'gemini-2.5-pro';
    const effort = req.effort || cliSettings?.agy?.effort || 'medium';

    const conversationTranscript = this.formatTranscript(req.messages);

    const fullPrompt = `${systemPrompt}\n\n## Conversation History:\n${conversationTranscript}\n\nArchitect:`;

    const args = ['-p', fullPrompt, '--output-format', 'text'];
    if (sessionId) {
      args.push('--conversation', sessionId);
    }
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);

    const result = await execa(binPath, args, {
      timeout: 35000,
    });

    const assistantText = result.stdout.trim();
    const suggestedSpec = this.extractSpecFromContent(assistantText);
    const cleanContent = this.stripSpecJsonFromContent(assistantText) || assistantText;

    return {
      message: {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: cleanContent,
        timestamp: new Date().toISOString(),
        suggested_spec: suggestedSpec,
      },
      suggested_spec: suggestedSpec,
      provider_used: `Local Antigravity CLI (${model}) [effort: ${effort}]`,
    };
  }

  private chatWithHeuristic(req: AiChatRequest): AiChatResponse {
    const rawLastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content || '';
    const lastUserMessage =
      rawLastUser.startsWith('> Replying to ') && rawLastUser.includes('\n\n')
        ? rawLastUser.slice(rawLastUser.indexOf('\n\n') + 2).trim()
        : rawLastUser;
    const projects = this.projectService.listProjects().map((p) => p.name);
    const affected = projects.length > 0
      ? projects.filter((p) => lastUserMessage.toLowerCase().includes(p.toLowerCase()))
      : ['backend'];
    const resolvedAffected = affected.length > 0 ? affected : (projects.length > 0 ? projects.slice(0, 2) : ['backend']);

    const title = lastUserMessage.length > 40
      ? lastUserMessage.slice(0, 37) + '...'
      : lastUserMessage || 'Proposed Feature Architecture';

    const spec: DraftRequirementResult = {
      title,
      goal: `Implement ${lastUserMessage} across affected services with automated test coverage.`,
      user_story: `As a developer, I want ${lastUserMessage}, so the workspace functions reliably.`,
      acceptance_criteria: [
        'Endpoint and data contracts agreed between affected projects',
        'Unit and integration tests pass on develop branch',
        'Manual review approved prior to main merge',
      ],
      affected_projects: resolvedAffected,
      api_hints: lastUserMessage.toLowerCase().includes('api') || lastUserMessage.toLowerCase().includes('upload')
        ? 'POST /api/v1/resource'
        : undefined,
      provider_used: 'Local Heuristic Architect (Offline)',
    };

    const replyContent = `### Architectural Assessment

**Proposed Multi-Repo Scope:**
- **Affected Projects**: \`${resolvedAffected.join(', ')}\`
- **Implementation Strategy**: Develop on \`develop\` branch with contract isolation.

**Key Technical Architecture:**
1. **Goal**: ${spec.goal}
2. **User Story**: ${spec.user_story}
3. **Acceptance Criteria**:
${spec.acceptance_criteria.map((c) => `   - ${c}`).join('\n')}
${spec.api_hints ? `4. **Contract / API Hints**: \`${spec.api_hints}\`\n` : ''}
We can continue refining this architecture, or type **/create** (or click the button in the header) to dispatch this requirement!`;

    return {
      message: {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: replyContent,
        timestamp: new Date().toISOString(),
        suggested_spec: spec,
      },
      suggested_spec: spec,
      provider_used: 'Local Heuristic Architect (Offline)',
    };
  }
}
