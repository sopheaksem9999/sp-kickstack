import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { fetchNotificationFeed, markAllNotificationsRead } from '../lib/humanLoopApi.js';
import { describeNotification, type NotificationTone } from '../lib/notificationText.js';

const DOT: Record<NotificationTone, string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
};

/** Header bell: what needs attention, newest first; click to open the requirement. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: events = [] } = useQuery({ queryKey: ['notifications'], queryFn: fetchNotificationFeed, refetchInterval: 60_000 });
  const markRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = events.flatMap((event) => {
    const text = describeNotification(event);
    return text ? [{ event, text }] : [];
  });
  const unread = items.filter((i) => !i.event.read).length;
  const label = unread ? `${unread} unread notifications` : 'Notifications';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title={label}
          aria-label={label}
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#262626] transition-colors relative"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#ec4899] text-white text-[9px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-[#2e303d]">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Notifications</span>
          <button
            disabled={unread === 0 || markRead.isPending}
            onClick={() => markRead.mutate()}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#7b68ee] disabled:opacity-40"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">Nothing needs your attention.</p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto py-1">
            {items.map(({ event, text }) => (
              <li key={event.id}>
                <button
                  onClick={() => {
                    setOpen(false);
                    if (text.href) navigate(text.href);
                  }}
                  className={`w-full text-left flex gap-2.5 px-3 py-2 hover:bg-slate-100 dark:hover:bg-[#262732] ${event.read ? 'opacity-60' : ''}`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[text.tone]}`} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">{text.title}</span>
                    {text.detail && <span className="block text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{text.detail}</span>}
                    <span className="block text-[10px] text-slate-400">{new Date(event.at).toLocaleString()}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
