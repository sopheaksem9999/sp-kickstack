import React, { useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { Popover, PopoverContent, PopoverTrigger } from './popover.js';
import { cn } from './sheet.js';

export interface DatePickerProps {
  value?: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  // Parse current value
  const parsedDate = value ? parseISO(value) : undefined;
  const selectedDate = parsedDate && isValid(parsedDate) ? parsedDate : undefined;

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      const formatted = format(day, 'yyyy-MM-dd');
      onChange(formatted);
      setOpen(false);
    } else {
      onChange('');
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'w-full flex items-center justify-between px-3 py-2 text-sm bg-slate-50 dark:bg-[#15161c] border border-slate-300 dark:border-[#2e303d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all text-left group',
            !selectedDate && 'text-slate-400 dark:text-slate-500',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <CalendarIcon className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="truncate">
              {selectedDate ? format(selectedDate, 'MMM d, yyyy') : placeholder}
            </span>
          </div>

          {selectedDate && !disabled ? (
            <div
              onClick={handleClear}
              className="p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-[#282a36] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              title="Clear date"
            >
              <X className="w-3.5 h-3.5" />
            </div>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-auto p-3 bg-white dark:bg-[#1a1b23] border border-slate-200 dark:border-[#2e303d] rounded-2xl shadow-xl"
      >
        <div className="sp-date-picker-wrapper text-slate-900 dark:text-slate-100">
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            autoFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
