// Files attached to review comments: one folder per comment under <workspace>/review-attachments.
import fs from 'node:fs';
import path from 'node:path';
import type { ReviewAttachmentUpload, ReviewCommentAttachment } from '@sp-kickstack/shared';
import { badRequest } from '../lib/httpError.js';

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
};
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'md', 'csv', 'json', 'yaml', 'yml']);

const extension = (name: string) => path.extname(name).slice(1).toLowerCase();

/** The file's type from its extension. */
export function attachmentType(name: string): string {
  return TYPES[extension(name)] ?? 'application/octet-stream';
}

/** Logs and other plain text a prompt can quote. */
export function isTextAttachment(name: string, type?: string): boolean {
  return TEXT_EXTENSIONS.has(extension(name)) || Boolean(type?.startsWith('text/'));
}

/** A file name without folders or characters a file system or a prompt would trip over. */
export function safeAttachmentName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[^\w.\- ()@+]/g, '_').replace(/^\.+/, '').trim();
  return base.slice(-150) || 'file';
}

/** The bytes of a data URL (base64 or URL-encoded), or null when it is not one. */
export function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    return match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]), 'utf8');
  } catch {
    return null;
  }
}

/** Decode every upload first (nothing is written when one is broken); names made safe and unique. */
export function decodeUploads(uploads: ReviewAttachmentUpload[]): Array<{ name: string; data: Buffer; type?: string }> {
  const used = new Set<string>();
  return uploads.map((upload) => {
    const data = decodeDataUrl(upload.data_url);
    if (!data) throw badRequest(`Attachment ${upload.name} has no file data`);
    const safe = safeAttachmentName(upload.name);
    let name = safe;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const ext = path.extname(safe);
      name = `${safe.slice(0, safe.length - ext.length)}-${n}${ext}`;
    }
    used.add(name.toLowerCase());
    return { name, data, type: upload.type };
  });
}

export function writeAttachments(dir: string, files: Array<{ name: string; data: Buffer }>): void {
  if (files.length === 0) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file.name), file.data);
}

/** The files kept in `dir`, by name. */
export function listAttachments(dir: string): ReviewCommentAttachment[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, size: fs.statSync(path.join(dir, entry.name)).size, type: attachmentType(entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The path of the file `name` in `dir` when it exists there (a bare name only), else null. */
export function attachmentPath(dir: string, name: string): string | null {
  if (!name || name !== path.basename(name) || name.startsWith('.')) return null;
  const file = path.join(dir, name);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}
