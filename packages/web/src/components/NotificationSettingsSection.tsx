import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Send, Trash2 } from 'lucide-react';
import type { NotificationChannelConfig, NotificationSettings } from '@sp-kickstack/shared';
import { fetchNotificationSettings, saveNotificationSettings, testNotificationChannel } from '../lib/humanLoopApi.js';
import { CHANNEL_HINTS, NOTIFY_EVENT_LABELS, newChannel } from '../lib/notificationText.js';

const TYPES: Array<NotificationChannelConfig['type']> = ['slack', 'telegram', 'webhook'];
const input =
  'w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200';

/** Settings → Notifications: where events that need a person are sent. */
export function NotificationSettingsSection() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['notification-settings'], queryFn: fetchNotificationSettings });
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (s: NotificationSettings) => saveNotificationSettings({ channels: s.channels, events: s.events, app_url: s.app_url }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['notification-settings'], saved);
      setDraft(saved);
      toast.success('Notification settings saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const test = useMutation({
    mutationFn: (channelId: string) => testNotificationChannel(channelId),
    onSuccess: (results) => {
      for (const r of results) {
        if (r.ok) toast.success(`${r.channel}: test message sent`);
        else toast.error(`${r.channel}: ${r.error ?? 'the test message could not be sent. Check the URL and try again.'}`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!draft) {
    return isError ? (
      <p className="text-xs text-rose-600 dark:text-rose-400">Could not load notification settings. Check that the server is running, then reload this page.</p>
    ) : (
      <p className="text-xs text-slate-500">Loading…</p>
    );
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const setChannel = (id: string, patch: Partial<NotificationChannelConfig>) =>
    setDraft({ ...draft, channels: draft.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Links in messages</h3>
        <input
          className={input}
          aria-label="Web app address for links in messages"
          value={draft.app_url}
          onChange={(e) => setDraft({ ...draft, app_url: e.target.value })}
          placeholder="http://localhost:4101 (leave empty for no links)"
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Channels</h3>
          <button
            onClick={() => setDraft({ ...draft, channels: [...draft.channels, newChannel()] })}
            disabled={draft.channels.length >= 10}
            className="flex items-center gap-1 text-xs font-semibold text-[#7b68ee] disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            Add channel
          </button>
        </div>
        {draft.channels.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">No channels yet. Notifications still show in the bell and as toasts.</p>
        )}
        {draft.channels.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 dark:border-[#2e303d] p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {TYPES.map((type) => (
                <button
                  key={type}
                  aria-pressed={c.type === type}
                  onClick={() => setChannel(c.id, { type })}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border capitalize ${
                    c.type === type ? 'bg-[#7b68ee] border-[#7b68ee] text-white' : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {type}
                </button>
              ))}
              <span className="flex-1" />
              <button
                role="switch"
                aria-checked={c.enabled}
                aria-label="Channel enabled"
                onClick={() => setChannel(c.id, { enabled: !c.enabled })}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                  c.enabled ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-[#262732] text-slate-500'
                }`}
              >
                {c.enabled ? 'On' : 'Off'}
              </button>
              <button
                onClick={() => test.mutate(c.id)}
                disabled={dirty || test.isPending}
                title={dirty ? 'Save first, then test' : 'Send a test message'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-[#2e303d] disabled:opacity-40"
              >
                <Send className="w-3 h-3" />
                Test
              </button>
              <button
                onClick={() => setDraft({ ...draft, channels: draft.channels.filter((x) => x.id !== c.id) })}
                className="text-slate-400 hover:text-rose-500"
                title="Remove channel"
                aria-label="Remove channel"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              className={input}
              aria-label="Channel name"
              value={c.name}
              onChange={(e) => setChannel(c.id, { name: e.target.value })}
              placeholder="Name, e.g. Team channel"
            />
            <input
              className={input}
              aria-label="Channel URL"
              value={c.url}
              onChange={(e) => setChannel(c.id, { url: e.target.value })}
              placeholder={CHANNEL_HINTS[c.type]}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{CHANNEL_HINTS[c.type]}</p>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Send these events</h3>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {Object.entries(NOTIFY_EVENT_LABELS).map(([type, label]) => {
            const on = Boolean(draft.events[type]);
            return (
              <button
                key={type}
                role="switch"
                aria-checked={on}
                onClick={() => setDraft({ ...draft, events: { ...draft.events, [type]: !on } })}
                className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
                  on ? 'border-[#7b68ee] text-slate-800 dark:text-slate-100' : 'border-slate-200 dark:border-[#2e303d] text-slate-500'
                }`}
              >
                <span>{label}</span>
                <span className={`text-[10px] font-bold ${on ? 'text-[#7b68ee]' : ''}`}>{on ? 'On' : 'Off'}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex gap-2">
        <button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(draft)}
          className="px-4 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6a5acd] text-white text-xs font-bold disabled:opacity-40"
        >
          Save
        </button>
        {dirty && (
          <button onClick={() => data && setDraft(data)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold">
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}
