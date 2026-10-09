import { AppDatabase } from '../db/index.js';
import { CreateSharedAssetInput, SharedAsset } from '@sp-kickstack/shared';

export interface TicketAttachmentItem {
  req_id: string;
  req_title: string;
  name: string;
  size?: number;
  type?: string;
  data_url?: string;
  created_at: string;
}

export interface AssetsResponse {
  ticket_attachments: TicketAttachmentItem[];
  shared_assets: SharedAsset[];
}

export class AssetService {
  constructor(private db: AppDatabase) {}

  public getAssets(workspaceId?: string): AssetsResponse {
    // 1. Gather all ticket attachments
    const reqSql =
      workspaceId && workspaceId !== 'all'
        ? 'SELECT id, title, attachments, created_at FROM requirements WHERE workspace_id = ? ORDER BY seq DESC'
        : 'SELECT id, title, attachments, created_at FROM requirements ORDER BY seq DESC';

    const reqRows = (
      workspaceId && workspaceId !== 'all'
        ? this.db.prepare(reqSql).all(workspaceId)
        : this.db.prepare(reqSql).all()
    ) as Array<{ id: string; title: string; attachments: string; created_at: string }>;

    const ticket_attachments: TicketAttachmentItem[] = [];
    for (const r of reqRows) {
      if (!r.attachments) continue;
      try {
        const parsed = JSON.parse(r.attachments);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            ticket_attachments.push({
              req_id: r.id,
              req_title: r.title,
              name: item.name,
              size: item.size,
              type: item.type,
              data_url: item.data_url,
              created_at: r.created_at,
            });
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // 2. Gather shared assets
    const sharedSql =
      workspaceId && workspaceId !== 'all'
        ? 'SELECT * FROM shared_assets WHERE workspace_id = ? ORDER BY created_at DESC'
        : 'SELECT * FROM shared_assets ORDER BY created_at DESC';

    const sharedRows = (
      workspaceId && workspaceId !== 'all'
        ? this.db.prepare(sharedSql).all(workspaceId)
        : this.db.prepare(sharedSql).all()
    ) as SharedAsset[];

    return {
      ticket_attachments,
      shared_assets: sharedRows,
    };
  }

  public createSharedAsset(input: CreateSharedAssetInput): SharedAsset {
    const id = `ast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO shared_assets (id, workspace_id, name, type, size, data_url, notes, created_at)
      VALUES (@id, @workspace_id, @name, @type, @size, @data_url, @notes, @created_at)
    `).run({
      id,
      workspace_id: input.workspace_id || 'default',
      name: input.name,
      type: input.type || 'application/octet-stream',
      size: input.size || 0,
      data_url: input.data_url,
      notes: input.notes || null,
      created_at: now,
    });

    return (this.db.prepare('SELECT * FROM shared_assets WHERE id = ?').get(id) as SharedAsset);
  }

  public deleteSharedAsset(id: string): { ok: boolean } {
    this.db.prepare('DELETE FROM shared_assets WHERE id = ?').run(id);
    return { ok: true };
  }
}
