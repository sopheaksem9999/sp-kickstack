import * as React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './popover.js';
import { ChevronDown, Check } from 'lucide-react';
import { clsx } from 'clsx';

export interface RadixSelectOption<T = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface RadixSelectProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options: RadixSelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  contentClassName?: string;
}

export function RadixSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  disabled = false,
  size = 'md',
  className,
  contentClassName,
}: RadixSelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((opt) => opt.value === value);

  const sizeClasses = {
    xs: 'h-7 px-2 py-1 text-[11px] rounded-md',
    sm: 'h-8 px-2.5 py-1.5 text-xs rounded-lg',
    md: 'h-9 px-3 py-2 text-xs rounded-lg',
  }[size];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={clsx(
            'w-full flex items-center justify-between border font-semibold transition-all cursor-pointer outline-none focus:ring-2 focus:ring-[#7b68ee]',
            sizeClasses,
            'border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-[#3a3a3a] shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed',
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
            {selected?.badge && <span className="shrink-0 ml-1">{selected.badge}</span>}
          </div>
          <ChevronDown
            className={clsx(
              'w-3.5 h-3.5 text-slate-400 shrink-0 ml-2 transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className={clsx(
          'w-[var(--radix-popover-trigger-width)] min-w-[200px] p-1.5 rounded-xl border border-slate-200 dark:border-[#303030] bg-white dark:bg-[#202020] text-slate-900 dark:text-slate-100 shadow-xl z-50 max-h-64 overflow-y-auto',
          contentClassName
        )}
      >
        <div className="space-y-0.5">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                disabled={opt.disabled}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                  isSelected
                    ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2a2a2a]'
                )}
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  <span className="truncate">{opt.label}</span>
                  {opt.badge && <span className="shrink-0 ml-1">{opt.badge}</span>}
                </div>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 stroke-[2.5]" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
