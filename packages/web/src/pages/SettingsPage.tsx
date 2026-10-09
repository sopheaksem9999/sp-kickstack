export function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Bridge Settings</h2>
        <p className="text-sm text-slate-400">Configuration limits, poll intervals, and security gates</p>
      </div>

      <div className="border border-slate-800 rounded-xl p-6 bg-[#0d1322]/80 space-y-5">
        <h3 className="text-sm font-semibold uppercase font-mono text-slate-300">Safety & Execution Limits</h3>

        <div className="grid grid-cols-2 gap-4 text-sm font-mono">
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 text-xs block">MAX_DEPTH</span>
            <span className="text-white font-bold text-lg">3</span>
            <p className="text-[11px] text-slate-500 mt-1">Maximum allowed ticket recursion depth</p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 text-xs block">MAX_TICKETS_PER_REQ</span>
            <span className="text-white font-bold text-lg">10</span>
            <p className="text-[11px] text-slate-500 mt-1">Maximum cross-repo tickets per requirement</p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 text-xs block">WATCH_INTERVAL_MS</span>
            <span className="text-white font-bold text-lg">5000 ms</span>
            <p className="text-[11px] text-slate-500 mt-1">Engine poller synchronization frequency</p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 text-xs block">MAX_BODY_BYTES</span>
            <span className="text-white font-bold text-lg">20 KB</span>
            <p className="text-[11px] text-slate-500 mt-1">Maximum payload size for tickets</p>
          </div>
        </div>
      </div>
    </div>
  );
}
