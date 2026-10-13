import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { Requirement } from '@sp-kickstack/shared';
import { RunSettingsDialog } from './RunSettingsDialog.js';
import { runSettingsSummary } from '../lib/runSettings.js';

/** Requirement page: how this requirement's agents run, with Edit. */
export function RunSettingsCard({ req }: { req: Requirement }) {
  const [open, setOpen] = useState(false);
  const closed = req.status === 'done' || req.status === 'cancelled';
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] text-[11px]">
        {runSettingsSummary(req).map((part, i) => (
          <span key={i} className="font-semibold text-slate-700 dark:text-slate-300">
            {part}
          </span>
        ))}
        {!closed && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-bold text-[#7b68ee] hover:underline">
            <Settings2 className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>
      <RunSettingsDialog req={req} mode="edit" open={open} onOpenChange={setOpen} />
    </>
  );
}
