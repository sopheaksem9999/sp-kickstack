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

  it('reviews and analyzes attached .md specification file', async () => {
    const session = chatService.createSession({ title: 'Spec Review Session', provider: 'heuristic' });
    const specMd = `# Multilingual Translation Module
## Service Database Schema
Create tables for services and service_translations with compound unique constraints.
## API Locale Negotiation
Support Accept-Language header with default English fallback.
## Admin Content Management
Admin dashboard endpoints for managing localized translations.`;

    const base64Spec = Buffer.from(specMd).toString('base64');
    const response = await chatService.sendSessionMessage(session.id, {
      content: 'Can you review and analyze the attached requirement spec file?',
      attachments: [
        {
          name: 'translation_spec.md',
          type: 'text/markdown',
          size: specMd.length,
          data_url: `data:text/markdown;base64,${base64Spec}`,
        },
      ],
    });

    expect(response.message.content).toContain('Architectural Review & Analysis: Multilingual Translation Module');
    expect(response.message.content).toContain('translation_spec.md');
    expect(response.message.content).toContain('Module: Service Database Schema');
    expect(response.message.content).toContain('Module: API Locale Negotiation');
    expect(response.message.content).toContain('create requirement separate task from module or feature');
  });

  it('creates requirement with tasks separated by module when user asks conversationally in chat without button click', async () => {
    const session = chatService.createSession({ title: 'Modular Creation Session', provider: 'heuristic' });
    const specMd = `# Payment and Billing Gateway
## Database & Stripe Ledger
Create ledger and webhook events table.
## Webhook Handlers
Handle invoice.payment_succeeded with idempotency.
## Merchant Dashboard
Frontend views for viewing invoices.`;

    const base64Spec = Buffer.from(specMd).toString('base64');
    // First message attaches spec and reviews
    await chatService.sendSessionMessage(session.id, {
      content: 'Analyze this spec',
      attachments: [
        {
          name: 'billing.md',
          type: 'text/markdown',
          size: specMd.length,
          data_url: `data:text/markdown;base64,${base64Spec}`,
        },
      ],
    });

    // Second message: conversational creation requesting task separation by module
    const createResponse = await chatService.sendSessionMessage(session.id, {
      content: 'create the requrement seperate task form module or feature in system app',
    });

    expect(createResponse.message.content).toContain('Requirement Ticket Created in System App');
    expect(createResponse.message.content).toMatch(/#REQ-\d+/);
    expect(createResponse.message.content).toContain('[Module:');

    // Verify it exists in SQLite requirements table
    const reqs = db.prepare('SELECT * FROM requirements WHERE session_id = ?').all(session.id) as any[];
    expect(reqs.length).toBe(1);
    expect(reqs[0].body_md).toContain('## Acceptance criteria');
    expect(reqs[0].body_md).toContain('[Module:');
  });

  it('reads actual record data from SQLite when user asks questions about created ticket in chat', async () => {
    const session = chatService.createSession({ title: 'Query Ticket Session', provider: 'heuristic' });
    // Create requirement first
    await chatService.sendSessionMessage(session.id, {
      content: 'I want to build a User Authentication microservice with JWT and OAuth',
    });
    const createRes = await chatService.sendSessionMessage(session.id, {
      content: 'create ticket in system app',
    });

    const match = createRes.message.content.match(/#(REQ-\d+)/);
    expect(match).toBeDefined();
    const reqId = match![1];

    // Query ticket in chat
    const queryRes = await chatService.sendSessionMessage(session.id, {
      content: `what are the acceptance criteria for ${reqId}?`,
    });

    expect(queryRes.message.content).toContain(`Record Details for [#${reqId}`);
    expect(queryRes.message.content).toContain('Acceptance Criteria & Modular Tasks');
    expect(queryRes.message.content).toContain(`Open Form (#${reqId})`);

    // Query using "read data from record created"
    const queryRecordRes = await chatService.sendSessionMessage(session.id, {
      content: 'read data from record created',
    });
    expect(queryRecordRes.message.content).toContain(`Record Details for [#${reqId}`);
    expect(queryRecordRes.message.content).toContain('Status');
    expect(queryRecordRes.message.content).toContain('Priority');
  });

  it('edits requirement record from chat and confirms changes with clickable key', async () => {
    const session = chatService.createSession({ title: 'Edit Ticket Session', provider: 'heuristic' });
    await chatService.sendSessionMessage(session.id, {
      content: 'I want to build a Search Service with Elasticsearch',
    });
    const createRes = await chatService.sendSessionMessage(session.id, {
      content: 'create ticket',
    });

    const match = createRes.message.content.match(/#(REQ-\d+)/);
    expect(match).toBeDefined();
    const reqId = match![1];

    // Verify initial priority is 'high'
    const initialReq = db.prepare('SELECT * FROM requirements WHERE id = ?').get(reqId) as any;
    expect(initialReq.priority).toBe('high');

    // Conversational edit: change priority to urgent and add acceptance criteria
    const editRes = await chatService.sendSessionMessage(session.id, {
      content: `edit ${reqId}: change priority to urgent and add acceptance criteria: Implement query caching with Redis`,
    });

    expect(editRes.message.content).toContain('Requirement Record Updated in System');
    expect(editRes.message.content).toContain(`#${reqId}`);
    expect(editRes.message.content).toContain('Priority');
    expect(editRes.message.content).toContain('urgent');
    expect(editRes.message.content).toContain(`Open Form (#${reqId})`);

    // Verify database record was updated
    const updatedReq = db.prepare('SELECT * FROM requirements WHERE id = ?').get(reqId) as any;
    expect(updatedReq.priority).toBe('urgent');
    expect(updatedReq.body_md).toContain('Implement query caching with Redis');
  });
});


