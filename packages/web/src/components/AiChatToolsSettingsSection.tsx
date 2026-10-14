import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plug, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { AiChatSkill, AiChatToolsView } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { RichCommentEditor } from './RichCommentEditor.js';
import {
  fetchAiChatTools, importMcpJson, importSkillsFolder, reimportSkill, saveAiChatTools, syncAgyList, testAiChatServer,
} from '../lib/aiChatToolsApi.js';
import {
  importSummary, secretRows, secretsFromRows, serverBadge, serverProblem, serverSummary, skillProblem, toUpdate,
  type SecretRow, type ViewServer,
} from '../lib/aiChatTools.js';

const box = 'bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-5 space-y-3';
const field = 'w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#1a1a1a] text-xs';
const button =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#2c2c2c] disabled:opacity-50';
const primary = 'px-3 py-1.5 rounded-lg bg-[#7b68ee] text-white text-xs font-bold disabled:opacity-50';
const BADGE = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  idle: 'bg-slate-100 text-slate-600 dark:bg-[#2c2c2c] dark:text-slate-300',
};

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function SecretRows({ label, rows, keyHint, onChange }: { label: string; rows: SecretRow[]; keyHint: string; onChange: (rows: SecretRow[]) => void }) {
  const set = (i: number, patch: Partial<SecretRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          <input className={field} aria-label={`${label} name`} placeholder={keyHint} value={row.key} onChange={(e) => set(i, { key: e.target.value })} />
          <input
            className={field}
            type="password"
            aria-label={`${label} value`}
            placeholder={row.kept ? '•••• set (type to replace)' : 'value'}
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value, kept: false })}
          />
          <button type="button" className={button} aria-label={`Remove ${row.key || 'row'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button type="button" className={button} onClick={() => onChange([...rows, { key: '', value: '', kept: false }])}>
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}

function ServerDialog({ server, taken, onSave, onClose }: { server?: ViewServer; taken: string[]; onSave: (s: ViewServer) => void; onClose: () => void }) {
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState((server?.args ?? []).join('\n'));
  const [url, setUrl] = useState(server?.url ?? '');
  const [env, setEnv] = useState<SecretRow[]>(secretRows(server?.env ?? {}));
  const [headers, setHeaders] = useState<SecretRow[]>(secretRows(server?.headers ?? {}));
  const problem = serverProblem({ name, transport, command, url }, taken);
  const renamedWithKept = Boolean(server && name !== server.name && [...env, ...headers].some((r) => r.kept && !r.value));
  const save = () =>
    onSave({
      name,
      enabled: server?.enabled ?? true,
      transport,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args.split('\n').map((a) => a.trim()).filter(Boolean) : [],
      env: transport === 'stdio' ? secretsFromRows(env) : {},
      url: transport === 'http' ? url.trim() : undefined,
      headers: transport === 'http' ? secretsFromRows(headers) : {},
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.name}` : 'Add an MCP server'}</DialogTitle>
          <DialogDescription>AI Chat starts it for every message while it is on.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <input className={field} aria-label="Server name" placeholder="Name, e.g. jira" value={name} onChange={(e) => setName(e.target.value)} />
          <div role="radiogroup" aria-label="Type" className="flex gap-1.5">
            {(['stdio', 'http'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={transport === t} onClick={() => setTransport(t)} className={transport === t ? primary : button}>
                {t === 'stdio' ? 'Command (stdio)' : 'URL (http)'}
              </button>
            ))}
          </div>
          {transport === 'stdio' ? (
            <>
              <input className={field} aria-label="Command" placeholder="Command, e.g. npx" value={command} onChange={(e) => setCommand(e.target.value)} />
              <textarea className={field} aria-label="Arguments" rows={3} placeholder={'Arguments, one per line, e.g.\n-y\n@atlassian/mcp-server'} value={args} onChange={(e) => setArgs(e.target.value)} />
              <SecretRows label="Environment variables" keyHint="e.g. JIRA_TOKEN" rows={env} onChange={setEnv} />
            </>
          ) : (
            <>
              <input className={field} aria-label="URL" placeholder="https://…/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
              <SecretRows label="Headers" keyHint="e.g. Authorization" rows={headers} onChange={setHeaders} />
            </>
          )}
          {renamedWithKept && <p className="text-amber-600">Renaming clears the stored secrets: type them again.</p>}
          {problem && <p className="text-rose-600">{problem}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button type="button" className={primary} disabled={Boolean(problem)} onClick={save}>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillDialog({ skill, taken, onSave, onClose }: { skill?: AiChatSkill; taken: string[]; onSave: (s: AiChatSkill) => void; onClose: () => void }) {
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [mode, setMode] = useState<AiChatSkill['mode']>(skill?.mode ?? 'on_request');
  const [body, setBody] = useState(skill?.body ?? '');
  const problem = skillProblem(name, taken);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{skill ? `Edit /${skill.name}` : 'New skill'}</DialogTitle>
          <DialogDescription>Instructions the AI follows when this skill applies.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <input className={field} aria-label="Skill name" placeholder="Name, e.g. api-contract" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} aria-label="When to use" placeholder="When to use, e.g. when writing an API contract" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div role="radiogroup" aria-label="When it applies" className="flex gap-1.5">
            {(['on_request', 'always'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={mode === m ? primary : button}>
                {m === 'always' ? 'Always' : 'On request (/name)'}
              </button>
            ))}
          </div>
          <RichCommentEditor value={body} onChange={setBody} sources={{}} allowFiles={false} ariaLabel="Instructions" placeholder="What the AI should do (Markdown)" />
          {problem && <p className="text-rose-600">{problem}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={primary}
            disabled={Boolean(problem)}
            onClick={() => onSave({ name, description: description.trim(), body, mode, enabled: skill?.enabled ?? true, ...(skill?.sourcePath ? { sourcePath: skill.sourcePath } : {}) })}
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextDialog({ title, description, label, placeholder, multiline, onSubmit, onClose }: {
  title: string; description: string; label: string; placeholder: string; multiline?: boolean; onSubmit: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {multiline ? (
          <textarea className={`${field} font-mono`} rows={10} aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <input className={`${field} font-mono`} aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <DialogFooter>
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button type="button" className={primary} disabled={!text.trim()} onClick={() => onSubmit(text)}>Import</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → AI Chat: MCP servers and skills for every AI Chat message (one list for the system). */
export function AiChatToolsSettingsSection() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['ai-chat-tools'], queryFn: fetchAiChatTools });
  const [serverEdit, setServerEdit] = useState<{ server?: ViewServer } | null>(null);
  const [skillEdit, setSkillEdit] = useState<{ skill?: AiChatSkill } | null>(null);
  const [dialog, setDialog] = useState<'paste' | 'import' | null>(null);
  const [reimportAsk, setReimportAsk] = useState<AiChatSkill | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const fail = (err: Error) => toast.error(err.message);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai-chat-tools'] });

  const save = useMutation({
    mutationFn: (view: AiChatToolsView) => saveAiChatTools(toUpdate(view)),
    onSuccess: (view) => {
      queryClient.setQueryData(['ai-chat-tools'], view);
      toast.success('AI Chat tools saved');
    },
    onError: fail,
  });
  const test = useMutation({ mutationFn: testAiChatServer, onSuccess: refresh, onError: fail });
  const agy = useMutation({
    mutationFn: syncAgyList,
    onSuccess: (r) => {
      refresh();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    },
    onError: fail,
  });
  const paste = useMutation({ mutationFn: importMcpJson, onSuccess: (r) => { refresh(); setDialog(null); toast.success(importSummary(r)); }, onError: fail });
  const importFolder = useMutation({ mutationFn: importSkillsFolder, onSuccess: (r) => { refresh(); setDialog(null); toast.success(importSummary(r)); }, onError: fail });
  const reimport = useMutation({ mutationFn: reimportSkill, onSuccess: () => { refresh(); setReimportAsk(null); toast.success('Skill re-imported'); }, onError: fail });

  if (error) return <p className="text-xs text-rose-600">{(error as Error).message}</p>;
  if (!data) return <p className="text-xs text-slate-500">Loading…</p>;
  const put = (patch: Partial<AiChatToolsView>) => save.mutate({ ...data, ...patch });
  const limitValue = limit ?? String(data.timeLimitSeconds);
  const limitOk = /^\d+$/.test(limitValue) && Number(limitValue) >= 5 && Number(limitValue) <= 1800;

  return (
    <div className="space-y-5">
      <div className={box}>
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Plug className="w-4 h-4 text-[#7b68ee]" />
          MCP servers for AI Chat
        </h2>
        <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          The AI can use any tool of an enabled server without asking. Only enable servers you are happy for it to use.
        </p>
        <div className="divide-y divide-slate-100 dark:divide-[#2d2d2d]">
          {data.servers.length === 0 && <p className="py-3 text-xs text-slate-500">No servers yet. Add one or paste a .mcp.json.</p>}
          {data.servers.map((s) => {
            const badge = serverBadge(s);
            return (
              <div key={s.name} className="py-2.5 flex items-center gap-3 flex-wrap">
                <Switch on={s.enabled} label={`Use ${s.name}`} onChange={(on) => put({ servers: data.servers.map((x) => (x.name === s.name ? { ...x, enabled: on } : x)) })} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold font-mono">
                    {s.name} <span className="font-normal text-slate-400">{s.transport}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">{serverSummary(s)}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${BADGE[badge.tone]}`}>{badge.text}</span>
                <button type="button" className={button} disabled={test.isPending} onClick={() => test.mutate(s.name)}>
                  {test.isPending && test.variables === s.name ? 'Testing…' : 'Test'}
                </button>
                <button type="button" className={button} aria-label={`Edit ${s.name}`} onClick={() => setServerEdit({ server: s })}>
                  <Pencil className="w-3 h-3" />
                </button>
                <button type="button" className={button} aria-label={`Delete ${s.name}`} onClick={() => put({ servers: data.servers.filter((x) => x.name !== s.name) })}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => setServerEdit({})}>
            <Plus className="w-3 h-3" />
            Add server
          </button>
          <button type="button" className={button} onClick={() => setDialog('paste')}>Paste .mcp.json</button>
        </div>
      </div>

      <div className={box}>
        <h2 className="text-sm font-bold">AGY</h2>
        {!data.agy.detected ? (
          <p className="text-xs text-slate-500">AGY not detected.</p>
        ) : (
          <>
            <p className="text-[11px] text-slate-500">
              {data.agy.usesMcp
                ? "Enabled servers above are added to AGY's list as sp-<name>. AGY uses its list in your own sessions too, and keeps their secrets in its own config (~/.gemini/config/mcp_config.json)."
                : 'AGY chats do not use MCP tools on this PC; nothing is added to its list.'}
            </p>
            {data.agy.error && <p className="text-[11px] text-rose-600">{data.agy.error}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <tbody>
                  {data.agy.servers.map((s) => (
                    <tr key={s.name} className="border-t border-slate-100 dark:border-[#2d2d2d]">
                      <td className="py-1 pr-3 font-mono font-semibold">{s.name}</td>
                      <td className="py-1 pr-3">{s.type}</td>
                      <td className="py-1 pr-3">{s.status}</td>
                      <td className="py-1 font-mono text-slate-500 truncate max-w-[16rem]">{s.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" className={button} disabled={agy.isPending} onClick={() => agy.mutate()}>
                <RefreshCw className="w-3 h-3" />
                Update AGY's list
              </button>
              {data.agySync && (
                <span className={`text-[11px] ${data.agySync.ok ? 'text-slate-500' : 'text-rose-600'}`}>
                  {data.agySync.message} · {new Date(data.agySync.at).toLocaleString()}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className={box}>
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#7b68ee]" />
          Skills
        </h2>
        <p className="text-[11px] text-slate-500">Always: added to every chat message. On request: type /name in the chat.</p>
        <div className="divide-y divide-slate-100 dark:divide-[#2d2d2d]">
          {data.skills.length === 0 && <p className="py-3 text-xs text-slate-500">No skills yet. Write one or import a folder of SKILL.md files.</p>}
          {data.skills.map((k) => (
            <div key={k.name} className="py-2.5 flex items-center gap-3 flex-wrap">
              <Switch on={k.enabled} label={`Use skill ${k.name}`} onChange={(on) => put({ skills: data.skills.map((x) => (x.name === k.name ? { ...x, enabled: on } : x)) })} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold font-mono">/{k.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {k.description || 'No "when to use" yet'}
                  {k.sourcePath ? ` · from ${k.sourcePath}` : ''}
                </div>
              </div>
              <div role="radiogroup" aria-label={`When ${k.name} applies`} className="flex gap-1">
                {(['always', 'on_request'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={k.mode === m}
                    onClick={() => put({ skills: data.skills.map((x) => (x.name === k.name ? { ...x, mode: m } : x)) })}
                    className={k.mode === m ? primary : button}
                  >
                    {m === 'always' ? 'Always' : 'On request'}
                  </button>
                ))}
              </div>
              {k.sourcePath && (
                <button type="button" className={button} onClick={() => setReimportAsk(k)}>Re-import</button>
              )}
              <button type="button" className={button} aria-label={`Edit ${k.name}`} onClick={() => setSkillEdit({ skill: k })}>
                <Pencil className="w-3 h-3" />
              </button>
              <button type="button" className={button} aria-label={`Delete ${k.name}`} onClick={() => put({ skills: data.skills.filter((x) => x.name !== k.name) })}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => setSkillEdit({})}>
            <Plus className="w-3 h-3" />
            New skill
          </button>
          <button type="button" className={button} onClick={() => setDialog('import')}>Import folder</button>
        </div>
      </div>

      <div className={box}>
        <h2 className="text-sm font-bold">Chat time limit</h2>
        <div className="flex items-center gap-2 text-xs">
          <input type="number" min={5} max={1800} aria-label="Seconds per chat message" className={`${field} w-28`} value={limitValue} onChange={(e) => setLimit(e.target.value)} />
          <span>seconds per chat message</span>
          <button
            type="button"
            className={primary}
            disabled={!limitOk || limit === null}
            onClick={() => {
              put({ timeLimitSeconds: Number(limitValue) });
              setLimit(null);
            }}
          >
            Save
          </button>
        </div>
      </div>

      {serverEdit && (
        <ServerDialog
          server={serverEdit.server}
          taken={data.servers.map((s) => s.name).filter((n) => n !== serverEdit.server?.name)}
          onClose={() => setServerEdit(null)}
          onSave={(next) => {
            const servers = serverEdit.server ? data.servers.map((s) => (s.name === serverEdit.server!.name ? next : s)) : [...data.servers, next];
            put({ servers });
            setServerEdit(null);
          }}
        />
      )}
      {skillEdit && (
        <SkillDialog
          skill={skillEdit.skill}
          taken={data.skills.map((s) => s.name).filter((n) => n !== skillEdit.skill?.name)}
          onClose={() => setSkillEdit(null)}
          onSave={(next) => {
            const skills = skillEdit.skill ? data.skills.map((s) => (s.name === skillEdit.skill!.name ? next : s)) : [...data.skills, next];
            put({ skills });
            setSkillEdit(null);
          }}
        />
      )}
      {dialog === 'paste' && (
        <TextDialog
          title="Paste .mcp.json"
          description='Servers of a Claude-format file ({ "mcpServers": { … } }) are added; names that exist are skipped.'
          label=".mcp.json"
          placeholder='{ "mcpServers": { "jira": { "command": "npx", "args": ["-y", "…"] } } }'
          multiline
          onClose={() => setDialog(null)}
          onSubmit={(text) => paste.mutate(text)}
        />
      )}
      {dialog === 'import' && (
        <TextDialog
          title="Import skills"
          description="Every SKILL.md below this folder becomes an editable copy."
          label="Folder"
          placeholder="~/.claude/skills"
          onClose={() => setDialog(null)}
          onSubmit={(folder) => importFolder.mutate(folder)}
        />
      )}
      {reimportAsk && (
        <Dialog open onOpenChange={(open) => !open && setReimportAsk(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Re-import /{reimportAsk.name}?</DialogTitle>
              <DialogDescription>Its text is replaced by {reimportAsk.sourcePath}; edits made here are lost.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" className={button} onClick={() => setReimportAsk(null)}>Cancel</button>
              <button type="button" className={primary} disabled={reimport.isPending} onClick={() => reimport.mutate(reimportAsk.name)}>Re-import</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
