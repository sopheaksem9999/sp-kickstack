import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  fetchAssets,
  createSharedAsset,
  deleteSharedAsset,
} from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { toast } from 'sonner';
import {
  Paperclip,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  FileText,
  Download,
  Trash2,
  Plus,
  Search,
  Layers,
  Sparkles,
  Database,
  X,
  Upload,
} from 'lucide-react';
import { CreateSharedAssetInput } from '@sp-kickstack/shared';

export function AttachmentsPage() {
  const { activeWorkspaceId, workspaces, activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'ticket' | 'shared'>('ticket');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'sheet' | 'code' | 'doc'>('all');

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadWorkspaceId, setUploadWorkspaceId] = useState(
    activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default'
  );
  const [fileData, setFileData] = useState<{
    name: string;
    size: number;
    type: string;
    data_url: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', activeWorkspaceId],
    queryFn: () => fetchAssets(activeWorkspaceId),
  });

  const createAssetMutation = useMutation({
    mutationFn: (newAsset: CreateSharedAssetInput) => createSharedAsset(newAsset),
    onSuccess: (res) => {
      toast.success(`Uploaded shared asset: ${res.name}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setIsUploadOpen(false);
      setUploadName('');
      setUploadNotes('');
      setFileData(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to upload shared asset');
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (id: string) => deleteSharedAsset(id),
    onSuccess: () => {
      toast.success('Shared asset removed');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete asset');
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      toast.error('File size exceeds 15MB limit');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setFileData({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        data_url: reader.result as string,
      });
      if (!uploadName) {
        setUploadName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileData) {
      toast.error('Please select a file to upload');
      return;
    }
    createAssetMutation.mutate({
      workspace_id: uploadWorkspaceId,
      name: uploadName.trim() || fileData.name,
      notes: uploadNotes.trim() || undefined,
      type: fileData.type,
      size: fileData.size,
      data_url: fileData.data_url,
    });
  };

  const ticketAttachments = data?.ticket_attachments || [];
  const sharedAssets = data?.shared_assets || [];

  const getFileCategory = (name: string, type?: string): 'image' | 'sheet' | 'code' | 'doc' => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'sheet';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.svg') || lower.endsWith('.gif') || type?.startsWith('image/')) return 'image';
    if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.proto') || lower.endsWith('.ts') || lower.endsWith('.js')) return 'code';
    return 'doc';
  };

  const getFileIcon = (name: string, type?: string) => {
    const cat = getFileCategory(name, type);
    switch (cat) {
      case 'sheet':
        return <FileSpreadsheet className="w-5 h-5 text-emerald-500 shrink-0" />;
      case 'image':
        return <ImageIcon className="w-5 h-5 text-sky-500 shrink-0" />;
      case 'code':
        return <FileCode className="w-5 h-5 text-amber-500 shrink-0" />;
      default:
        return <FileText className="w-5 h-5 text-purple-500 shrink-0" />;
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Filter ticket attachments
  const filteredTicketAttachments = ticketAttachments.filter((att) => {
    const matchesSearch =
      att.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      att.req_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      att.req_title.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (typeFilter === 'all') return true;
    return getFileCategory(att.name, att.type) === typeFilter;
  });

  // Filter shared assets
  const filteredSharedAssets = sharedAssets.filter((asset) => {
    return (
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.notes && asset.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (asset.type && asset.type.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  const totalTicketBytes = ticketAttachments.reduce((sum, item) => sum + (item.size || 0), 0);
  const totalSharedBytes = sharedAssets.reduce((sum, item) => sum + (item.size || 0), 0);

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] flex items-center justify-center text-white shadow-md shadow-purple-500/20 font-black">
              📎
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Attachments & Assets Hub</span>
                {activeWorkspace && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50">
                    {activeWorkspace.name}
                  </span>
                )}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Centralized vault of ticket attachments & workspace-wide cross-repo contracts
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setUploadWorkspaceId(activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default');
              setIsUploadOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload Shared Asset</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-[#262732] bg-white dark:bg-[#181920] shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Ticket Attachments</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white">{ticketAttachments.length}</span>
            <span className="text-xs text-slate-500 font-mono">{formatSize(totalTicketBytes)}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-[#262732] bg-white dark:bg-[#181920] shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Shared Contracts</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-purple-600 dark:text-purple-400">{sharedAssets.length}</span>
            <span className="text-xs text-slate-500 font-mono">{formatSize(totalSharedBytes)}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-[#262732] bg-white dark:bg-[#181920] shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Referenced Specs</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {new Set(ticketAttachments.map((t) => t.req_id)).size}
            </span>
            <span className="text-xs text-slate-400">Linked tickets</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-[#262732] bg-white dark:bg-[#181920] shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Storage Footprint</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {formatSize(totalTicketBytes + totalSharedBytes)}
            </span>
            <span className="text-xs text-emerald-500 font-medium">Active DB Vault</span>
          </div>
        </div>
      </div>

      {/* Tabs and Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#262732] pb-3">
        {/* Tab Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('ticket')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'ticket'
                ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#20212b]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Ticket Attachments</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-200/60 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200">
              {ticketAttachments.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('shared')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'shared'
                ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#20212b]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Shared Workspace Assets</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-200/60 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200">
              {sharedAssets.length}
            </span>
          </button>
        </div>

        {/* Search & Type Filters */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'ticket' ? 'Filter file or REQ-...' : 'Search shared contract...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] w-48 sm:w-64"
            />
          </div>

          {activeTab === 'ticket' && (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#1f202a] p-1 rounded-lg border border-slate-200 dark:border-[#2a2b36] text-[11px] font-medium">
              {(['all', 'image', 'sheet', 'code', 'doc'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTypeFilter(mode)}
                  className={`px-2 py-0.5 rounded capitalize transition-all ${
                    typeFilter === mode
                      ? 'bg-white dark:bg-[#2c2d3a] text-purple-600 dark:text-purple-300 shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab 1 Content: Ticket Attachments */}
      {activeTab === 'ticket' && (
        <div>
          {isLoading ? (
            <div className="p-16 text-center text-slate-400 text-xs">Loading ticket attachments...</div>
          ) : filteredTicketAttachments.length === 0 ? (
            <div className="p-16 rounded-xl border border-dashed border-slate-200 dark:border-[#2a2b38] text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-[#20212c] text-slate-400 flex items-center justify-center mx-auto">
                <Paperclip className="w-5 h-5" />
              </div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-300">No ticket attachments found</div>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Attachments uploaded during requirement creation or via ticket tasks will automatically aggregate here.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-[#181920] rounded-xl border border-slate-200 dark:border-[#262732] overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-[#1c1d25] border-b border-slate-200 dark:border-[#262732] text-slate-400 uppercase tracking-wider text-[10px] font-bold">
                  <tr>
                    <th className="py-3 px-4">File Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Size</th>
                    <th className="py-3 px-4">Requirement Spec</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#22232d]">
                  {filteredTicketAttachments.map((file, idx) => (
                    <tr key={`${file.req_id}-${file.name}-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-[#1d1e27]/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-2.5">
                          {getFileIcon(file.name, file.type)}
                          <span className="truncate max-w-xs">{file.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase font-bold bg-slate-100 dark:bg-[#222430] text-slate-600 dark:text-slate-400">
                          {getFileCategory(file.name, file.type)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-xs">
                        {formatSize(file.size)}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          to={`/requirements/${file.req_id}`}
                          className="inline-flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-bold hover:underline"
                        >
                          <span className="font-mono bg-purple-50 dark:bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-900/40">
                            {file.req_id}
                          </span>
                          <span className="text-slate-600 dark:text-slate-300 font-normal truncate max-w-[200px]">
                            {file.req_title}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {file.data_url ? (
                          <a
                            href={file.data_url}
                            download={file.name}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 font-bold transition-all"
                            title="Download attachment"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </a>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Stored</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2 Content: Shared Workspace Assets */}
      {activeTab === 'shared' && (
        <div>
          {isLoading ? (
            <div className="p-16 text-center text-slate-400 text-xs">Loading shared workspace assets...</div>
          ) : filteredSharedAssets.length === 0 ? (
            <div className="p-16 rounded-xl border border-dashed border-slate-200 dark:border-[#2a2b38] text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-[#20212c] text-slate-400 flex items-center justify-center mx-auto">
                <Database className="w-5 h-5" />
              </div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-300">No shared workspace assets yet</div>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Upload shared OpenAPI/Swagger contracts, Protobuf specs, or system architecture files to inject into all fan-out agent tasks.
              </p>
              <button
                onClick={() => setIsUploadOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white font-bold text-xs hover:bg-purple-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Upload First Contract</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSharedAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-[#262732] bg-white dark:bg-[#181920] shadow-sm flex flex-col justify-between hover:border-purple-400/50 transition-all space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getFileIcon(asset.name, asset.type)}
                        <div>
                          <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[180px]">
                            {asset.name}
                          </h3>
                          <span className="text-[10px] text-slate-400 uppercase font-mono">
                            {asset.type || 'contract'}
                          </span>
                        </div>
                      </div>

                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                        {formatSize(asset.size)}
                      </span>
                    </div>

                    {asset.notes && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                        {asset.notes}
                      </p>
                    )}

                    <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 dark:border-[#22232c]">
                      <span>Workspace: <strong className="text-slate-600 dark:text-slate-300">{asset.workspace_id}</strong></span>
                      <span>{asset.created_at ? new Date(asset.created_at).toLocaleDateString() : 'Active'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <a
                      href={asset.data_url}
                      download={asset.name}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-900/50 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 text-xs font-bold transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete shared asset "${asset.name}"?`)) {
                          deleteAssetMutation.mutate(asset.id);
                        }
                      }}
                      disabled={deleteAssetMutation.isPending}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all"
                      title="Delete asset"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upload Shared Asset Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#181920] border border-slate-200 dark:border-[#262732] rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in-0 zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] flex items-center justify-center text-white font-bold text-sm">
                  ⚡
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Upload Shared Workspace Asset
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Contracts, schemas, and specs accessible by all project agents
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* Workspace Picker */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Workspace</label>
                <select
                  value={uploadWorkspaceId}
                  onChange={(e) => setUploadWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Asset Name */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Asset Name</label>
                <input
                  type="text"
                  placeholder="e.g. shared-auth-contract.yaml"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                />
              </div>

              {/* Notes / Description */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Notes / Scope (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Shared REST OpenAPI contract for backend & mobile"
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                />
              </div>

              {/* File Drop Area */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Select File (Max 15MB)</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 rounded-lg border-2 border-dashed border-slate-200 dark:border-[#2a2b38] hover:border-purple-400/80 cursor-pointer bg-slate-50/50 dark:bg-[#191a23] text-center transition-all"
                >
                  {fileData ? (
                    <div className="flex items-center justify-center gap-2 text-xs font-bold text-purple-600 dark:text-purple-300">
                      {getFileIcon(fileData.name, fileData.type)}
                      <span>{fileData.name} ({formatSize(fileData.size)})</span>
                    </div>
                  ) : (
                    <div className="space-y-1 text-slate-400">
                      <Upload className="w-5 h-5 mx-auto text-slate-400" />
                      <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Click to choose a file</div>
                      <div className="text-[10px] text-slate-400">YAML, JSON, Proto, Markdown, Images, Excel</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#20212a]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!fileData || createAssetMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white text-xs font-bold disabled:opacity-50 transition-all shadow-md shadow-purple-500/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{createAssetMutation.isPending ? 'Uploading...' : 'Save & Distribute'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
