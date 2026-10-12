import { useEffect, useId, useState, type ReactNode } from 'react';
import { Cpu } from 'lucide-react';
import type { ReasoningEffort } from '@sp-kickstack/shared';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { cn } from './ui/sheet.js';
import { EFFORTS, MODEL_SUGGESTIONS, isValidModel, pickerLabel } from '../lib/agentProfile.js';
import type { ProfileValue } from '../lib/agentProfile.js';

function Chip({ pressed, disabled, title, onClick, children }: { pressed: boolean; disabled?: boolean; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40',
        pressed
          ? 'bg-[#7b68ee] border-[#7b68ee] text-white'
          : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#262732]'
      )}
    >
      {children}
    </button>
  );
}

interface FieldsProps {
  value: ProfileValue;
  onChange: (next: ProfileValue) => void;
  disabled?: boolean;
  /** Tooltip for the two default chips, e.g. what the default means here. */
  defaultTitle?: string;
  /** Text of the two default chips; "Keep" where leaving it alone keeps what is already set. */
  defaultChipLabel?: string;
}

/** The model and effort choices on their own, for a popover or a form that already has its own container. */
export function AgentProfileFields({ value, onChange, disabled, defaultTitle, defaultChipLabel = 'Default' }: FieldsProps) {
  const custom = value.model && !MODEL_SUGGESTIONS.includes(value.model) ? value.model : '';
  const [draft, setDraft] = useState(custom);
  const hintId = useId();
  useEffect(() => setDraft(custom), [custom]);

  const typed = draft.trim();
  const invalid = typed !== '' && !isValidModel(typed);

  const pickModel = (model: string | null) => {
    setDraft('');
    if (model !== value.model) onChange({ ...value, model });
  };
  const applyDraft = () => {
    if (!typed || invalid) return;
    if (MODEL_SUGGESTIONS.includes(typed)) setDraft('');
    if (typed !== value.model) onChange({ ...value, model: typed });
  };
  const pickEffort = (effort: ReasoningEffort | null) => {
    if (effort !== value.effort) onChange({ ...value, effort });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Model</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Model">
          <Chip pressed={value.model === null} disabled={disabled} title={defaultTitle} onClick={() => pickModel(null)}>
            {defaultChipLabel}
          </Chip>
          {MODEL_SUGGESTIONS.map((m) => (
            <Chip key={m} pressed={value.model === m} disabled={disabled} onClick={() => pickModel(m)}>
              {m}
            </Chip>
          ))}
        </div>
        <input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={applyDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyDraft();
            }
          }}
          maxLength={80}
          aria-label="Other model id"
          aria-invalid={invalid}
          aria-describedby={invalid ? hintId : undefined}
          placeholder="Other model id, e.g. claude-opus-5-5"
          className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2 py-1.5 text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#7b68ee]/40 disabled:opacity-40"
        />
        {invalid && (
          <p id={hintId} className="text-[11px] text-rose-600 dark:text-rose-400">
            Use letters, digits and . _ : / - , e.g. opus
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Effort</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Effort">
          <Chip pressed={value.effort === null} disabled={disabled} title={defaultTitle} onClick={() => pickEffort(null)}>
            {defaultChipLabel}
          </Chip>
          {EFFORTS.map((e) => (
            <Chip key={e} pressed={value.effort === e} disabled={disabled} onClick={() => pickEffort(e)}>
              {e}
            </Chip>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">Engines that do not support a model or effort choice ignore it.</p>
    </div>
  );
}

interface PickerProps {
  value: ProfileValue;
  /** Called on every choice; the caller decides when to save. */
  onChange: (next: ProfileValue) => void;
  /** What Default resolves to, e.g. the workspace's setting; a choice of only one part shows the inherited other part too. */
  inherited?: { value: Partial<ProfileValue> | null | undefined; from: string };
  /** Trigger text while nothing is chosen and nothing is inherited; falls back to "Engine default". */
  defaultLabel?: string;
  /** Text of the two default chips in the options; "Keep" where leaving it alone keeps what is already set. */
  defaultChipLabel?: string;
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
}

/** A compact model and effort picker: a button showing the current choice that opens the options. */
export function AgentProfilePicker({ value, onChange, inherited, defaultLabel, defaultChipLabel, disabled, className }: PickerProps) {
  const { text: label, title } = pickerLabel(value, inherited, defaultLabel);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Agent model and effort"
          title={title}
          className={cn(
            'inline-flex items-center gap-1.5 max-w-[18rem] rounded-md text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7b68ee]/50 disabled:opacity-50',
            className
          )}
        >
          <Cpu className="w-3 h-3 shrink-0 text-[#7b68ee]" />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <AgentProfileFields
          value={value}
          onChange={onChange}
          disabled={disabled}
          defaultChipLabel={defaultChipLabel}
          defaultTitle={pickerLabel({ model: null, effort: null }, inherited, defaultLabel).text}
        />
      </PopoverContent>
    </Popover>
  );
}
