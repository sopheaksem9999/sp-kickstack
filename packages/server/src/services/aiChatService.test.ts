import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { SettingsService } from './settingsService.js';
import { AiChatService } from './aiChatService.js';
import { AiChatMessage } from '@sp-kickstack/shared';

describe('AiChatService', () => {
  let db: AppDatabase;
  let projectService: ProjectService;
  let settingsService: SettingsService;
  let chatService: AiChatService;

  beforeEach(() => {
    db = initDatabase(':memory:');
    projectService = new ProjectService(db);
    settingsService = new SettingsService(db);
    chatService = new AiChatService(db, projectService, settingsService);

    // Register test projects in workspace
    projectService.registerProject({
      name: 'backend',
      kind: 'backend',
      repo_path: '/workspace/backend',
      engine_type: 'stoneforge',
      base_branch: 'develop',
      done_means: 'merged',
      enabled: true,
    });

    projectService.registerProject({
      name: 'frontend',
      kind: 'frontend',
      repo_path: '/workspace/frontend',
      engine_type: 'stoneforge',
      base_branch: 'develop',
      done_means: 'merged',
      enabled: true,
    });
  });

  it('compiles workspace context into system prompt', () => {
    const context = chatService.compileWorkspaceContext();
    expect(context).toContain('backend');
    expect(context).toContain('/workspace/backend');
    expect(context).toContain('frontend');
    expect(context).toContain('/workspace/frontend');
    expect(context).toContain('develop');
  });

  it('extracts embedded json:spec block from assistant text', () => {
    const rawContent = `Here is our agreed architecture for user avatar uploads:

\`\`\`json:spec
{
  "title": "User Avatar Upload",
  "goal": "Allow users to upload avatars with local storage and canvas cropping",
  "user_story": "As a user, I want to upload an avatar, so I can personalize my profile",
  "acceptance_criteria": [
    "Upload endpoint accepts multipart/form-data under 2MB",
    "Frontend canvas crops image before upload"
  ],
  "affected_projects": ["backend", "frontend"],
  "api_hints": "POST /api/users/:id/avatar"
}
\`\`\`

Let me know if you would like to proceed!`;

    const extracted = chatService.extractSpecFromContent(rawContent);
    expect(extracted).toBeDefined();
    expect(extracted?.title).toBe('User Avatar Upload');
    expect(extracted?.affected_projects).toEqual(['backend', 'frontend']);
    expect(extracted?.acceptance_criteria.length).toBe(2);
  });

  it('handles multi-turn conversation and returns structured chat response in fallback mode', async () => {
    const messages: AiChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'I want to build an avatar upload endpoint and React component',
        timestamp: new Date().toISOString(),
      },
    ];

    const response = await chatService.chat({
      messages,
      provider: 'heuristic',
    });

    expect(response.message).toBeDefined();
    expect(response.message.role).toBe('assistant');
    expect(response.message.content.length).toBeGreaterThan(10);
    expect(response.message.content).not.toContain('I reviewed your requirement for:');
    expect(response.suggested_spec).toBeDefined();
    expect(response.suggested_spec?.affected_projects).toContain('backend');
  });

  it('manages multi-chat sessions and persists history across turns', async () => {
    // 1. Create a session
    const session = chatService.createSession({
      workspace_id: 'default',
      title: 'Avatar Upload Discussion',
      provider: 'heuristic',
    });

    expect(session.id).toBeDefined();
    expect(session.title).toBe('Avatar Upload Discussion');
    expect(session.messages?.length).toBe(1); // Seeding welcome message

    // 2. Send Turn 1
    const turn1 = await chatService.sendSessionMessage(session.id, {
      content: 'Can we add image compression on upload?',
      provider: 'heuristic',
    });

    expect(turn1.session.messages?.length).toBe(3); // welcome + user + assistant
    const userMsg1 = turn1.session.messages?.find((m) => m.content === 'Can we add image compression on upload?');
    expect(userMsg1).toBeDefined();

    // 3. Send Turn 2 in the SAME session (remembering history)
    const turn2 = await chatService.sendSessionMessage(session.id, {
      content: 'Also include JWT authorization for the endpoint',
      provider: 'heuristic',
    });

    expect(turn2.session.messages?.length).toBe(5); // welcome + turn1(2) + turn2(2)

    // 4. Retrieve session directly
    const fetched = chatService.getSession(session.id);
    expect(fetched?.messages?.length).toBe(5);

    // 5. List sessions
    const sessions = chatService.listSessions('default');
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s) => s.id === session.id)).toBe(true);

    // 6. Delete session
    const deleted = chatService.deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(chatService.getSession(session.id)).toBeNull();
  });

  it('supports multiple chat sessions with independent engine and effort configurations', () => {
    // Session A: Claude CLI with high effort
    const sessionA = chatService.createSession({
      workspace_id: 'default',
      title: 'Backend Database Design',
      provider: 'claude-cli',
      effort: 'high',
    });

    // Session B: Agy CLI with low effort
    const sessionB = chatService.createSession({
      workspace_id: 'default',
      title: 'Frontend UI Redesign',
      provider: 'agy-cli',
      effort: 'low',
    });

    expect(sessionA.provider).toBe('claude-cli');
    expect(sessionA.effort).toBe('high');
    expect(sessionB.provider).toBe('agy-cli');
    expect(sessionB.effort).toBe('low');

    // Update Session A to Max effort and Codex
    const updatedA = chatService.updateSession(sessionA.id, {
      provider: 'codex-cli',
      effort: 'max',
    });

    expect(updatedA?.provider).toBe('codex-cli');
    expect(updatedA?.effort).toBe('max');

    // Verify Session B was NOT affected (independent sessions)
    const fetchedB = chatService.getSession(sessionB.id);
    expect(fetchedB?.provider).toBe('agy-cli');
    expect(fetchedB?.effort).toBe('low');
  });

  it('persists and retrieves file attachments on chat messages', async () => {
    const session = chatService.createSession({
      workspace_id: 'default',
      title: 'Attachment Test Session',
      provider: 'heuristic',
    });

    const attachments = [
      {
        id: 'att_1',
        name: 'openapi-spec.json',
        type: 'application/json',
        size: 1024,
        data_url: 'data:application/json;base64,eyJoZWxsbyI6ICJ3b3JsZCJ9',
      },
      {
        id: 'att_2',
        name: 'architecture-diagram.png',
        type: 'image/png',
        size: 2048,
        data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        asset_id: 'shared_asset_123',
      },
    ];

    const result = await chatService.sendSessionMessage(session.id, {
      content: 'Please inspect the attached OpenAPI spec and diagram',
      attachments,
      provider: 'heuristic',
    });

    const userMessage = result.session.messages?.find((m) => m.content.includes('OpenAPI spec'));
    expect(userMessage).toBeDefined();
    expect(userMessage?.attachments).toBeDefined();
    expect(userMessage?.attachments?.length).toBe(2);
    expect(userMessage?.attachments?.[0].name).toBe('openapi-spec.json');
    expect(userMessage?.attachments?.[1].asset_id).toBe('shared_asset_123');

    // Retrieve session from db and verify attachments are preserved
    const fetched = chatService.getSession(session.id);
    const fetchedUserMsg = fetched?.messages?.find((m) => m.content.includes('OpenAPI spec'));
    expect(fetchedUserMsg?.attachments?.length).toBe(2);
    expect(fetchedUserMsg?.attachments?.[0].name).toBe('openapi-spec.json');
  });

  it('extracts rich architectural details, SQL tables, and contracts directly from chat messages', () => {
    const rawArchitecturalChat = `### Architectural Assessment: Multilingual Translation Module for \`services\` and \`pages\` (API)

To implement a clean, maintainable translation module in your backend API for dynamic content (such as \`services\` and \`pages\`), here are the recommended architectural approaches and standard best practices.

---

### 1. Database Schema Strategies

#### **Approach A: Dedicated Translation Tables (Recommended for Clean Normalization & Scale)**
Separate core business logic/metadata from localized text attributes.

\`\`\`sql
-- 1. Services Base Table
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    price DECIMAL(10, 2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Services Translation Table
CREATE TABLE service_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    locale VARCHAR(10) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    meta_keywords VARCHAR(255),
    CONSTRAINT uq_service_locale UNIQUE (service_id, locale)
);

-- 3. Pages Base Table
CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    is_published BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Pages Translation Table
CREATE TABLE page_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    locale VARCHAR(10) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    meta_title VARCHAR(255),
    meta_description TEXT,
    CONSTRAINT uq_page_locale UNIQUE (page_id, locale)
);
\`\`\`

---

### 2. API Contract & Content Negotiation

#### **Header-based Resolution with Fallback**
The API should accept the desired language via standard headers or query parameters:
- \`Accept-Language: km, en;q=0.9\` or \`?locale=km\`
- **Fallback Rule:** If the requested locale translation doesn't exist, fall back to the default locale (e.g., \`en\`).`;

    const messages: AiChatMessage[] = [
      {
        id: 'msg-u1',
        role: 'user',
        content: 'give me idea the implement the translate services and pages on api',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-a1',
        role: 'assistant',
        content: rawArchitecturalChat,
        timestamp: new Date().toISOString(),
      },
    ];

    const extracted = chatService.extractRichArchitectureFromMessages(messages, 'Translation Discussion', [
      'api',
      'frontend',
    ]);

    expect(extracted.title).toBe('Multilingual Translation Module for services and pages (API)');
    expect(extracted.goal).toContain('To implement a clean, maintainable translation module in your backend API');
    expect(extracted.affected_projects).toContain('api');
    expect(extracted.api_hints).toContain('Accept-Language');
    expect(extracted.acceptance_criteria.some((c) => c.includes('service_translations'))).toBe(true);
    expect(extracted.acceptance_criteria.some((c) => c.includes('page_translations'))).toBe(true);
    expect(extracted.notes).toContain('CREATE TABLE service_translations');
  });
});

