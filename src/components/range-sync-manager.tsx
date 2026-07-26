'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Zap,
    History,
    FileSpreadsheet,
    Activity,
    AlertCircle,
    CheckCircle2,
    Database,
    Square,
} from 'lucide-react';
import { getEndpoint, getRangeSyncableEndpoints, type EndpointDef } from '@/lib/endpoint-registry';
import { Progress } from '@/components/ui/progress';
import { FadeIn, SlideUp, StaggerContainer, StaggerItem, ScaleOnHover } from './ui/motion-primitives';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SyncStat {
    endpoint: string;
    year: string;
    newRecords: number;
    duplicatesOrTotal: number;
    status: 'success' | 'error';
    message?: string;
}

interface LogEntry {
    msg: string;
    type: 'info' | 'success' | 'error';
    time: string;
}

/** Which slice of the registry a range sync targets. */
type Scope = 'v1-data' | 'v1-dashboard' | 'legacy';

const SCOPES: { id: Scope; label: string; match: (ep: EndpointDef) => boolean }[] = [
    { id: 'v1-data', label: 'V1 · Data', match: (ep) => ep.generation === 'v1' && ep.group === 'data' },
    { id: 'v1-dashboard', label: 'V1 · Dashboard', match: (ep) => ep.group === 'dashboard' },
    { id: 'legacy', label: 'Legacy', match: (ep) => ep.generation === 'legacy' },
];

/** Upper bound on requests per endpoint/year, as a backstop against runaway loops. */
const MAX_BATCHES_PER_DATASET = 500;

export function RangeSyncManager() {
    const [rangeSyncConfig, setRangeSyncConfig] = useState({
        startYear: '2021',
        endYear: '2027',
        currentYear: null as string | null,
        isSyncing: false,
        forceSync: false,
    });

    const [stats, setStats] = useState<SyncStat[]>([]);
    const [activeScope, setActiveScope] = useState<Scope>('v1-data');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [progress, setProgress] = useState(0);
    const [syncingEndpoint, setSyncingEndpoint] = useState<string | null>(null);

    /** Read every iteration, so it must be a ref rather than state. */
    const cancelled = useRef(false);

    const targetEndpoints = useMemo(() => {
        const scope = SCOPES.find((s) => s.id === activeScope)!;
        return getRangeSyncableEndpoints().filter(scope.match);
    }, [activeScope]);

    const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
        const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
        setLogs((prev) => [{ msg, type, time }, ...prev].slice(0, 500));
    }, []);

    const addStat = useCallback((stat: SyncStat) => {
        setStats((prev) => [...prev, stat]);
    }, []);

    /**
     * Sync one endpoint/year to completion.
     *
     * Stops on `stalled`, which the server sets when a request fetched nothing
     * and did not reach the end of the data. Retrying an identical request in
     * that state used to spin forever, because the response was still
     * `success: true` and so passed the retry check.
     */
    const syncEndpoint = useCallback(
        async (endpoint: EndpointDef, year: string, allowForce: boolean) => {
            setSyncingEndpoint(endpoint.value);

            let totalNew = 0;
            let totalSkipped = 0;
            let totalRecords = 0;

            try {
                let isComplete = false;
                // Only the first request may wipe the dataset; passing it on
                // every batch would delete the file every 100 rows.
                let isFirstRequest = true;
                let batches = 0;

                while (!isComplete && !cancelled.current) {
                    if (++batches > MAX_BATCHES_PER_DATASET) {
                        throw new Error(`Berhenti setelah ${MAX_BATCHES_PER_DATASET} batch tanpa selesai`);
                    }

                    const res = await fetch('/api/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            endpoint: endpoint.value,
                            year,
                            batchSize: 100,
                            maxPages: 50,
                            forceOverwrite: isFirstRequest && allowForce && rangeSyncConfig.forceSync,
                        }),
                    });

                    const result = await res.json();
                    if (!res.ok || !result.success) {
                        throw new Error(result?.error || `HTTP ${res.status}`);
                    }

                    isFirstRequest = false;
                    totalNew += result.newRecords ?? 0;
                    totalSkipped += result.duplicatesSkipped ?? 0;
                    totalRecords = result.totalRecords ?? totalRecords;
                    isComplete = result.isComplete;

                    if (result.stalled) {
                        throw new Error(result.warning || 'Berhenti tanpa kemajuan');
                    }

                    if (!isComplete) await new Promise((r) => setTimeout(r, 400));
                }

                if (cancelled.current) return;

                addLog(`Selesai ${endpoint.label} (${year}): +${totalNew.toLocaleString('id-ID')} baris`, 'success');
                addStat({
                    endpoint: endpoint.label,
                    year,
                    newRecords: totalNew,
                    duplicatesOrTotal: endpoint.paginated ? totalSkipped : totalRecords,
                    status: 'success',
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Kesalahan tidak diketahui';
                console.error(`Range sync failed for ${endpoint.value} ${year}:`, error);
                addLog(`Gagal ${endpoint.label} (${year}): ${message}`, 'error');
                addStat({
                    endpoint: endpoint.label,
                    year,
                    newRecords: 0,
                    duplicatesOrTotal: 0,
                    status: 'error',
                    message,
                });
            } finally {
                setSyncingEndpoint(null);
            }
        },
        [rangeSyncConfig.forceSync, addLog, addStat],
    );

    const handleRangeSync = useCallback(async () => {
        const start = parseInt(rangeSyncConfig.startYear, 10);
        const end = parseInt(rangeSyncConfig.endYear, 10);

        if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
            addLog('Rentang tahun tidak valid.', 'error');
            return;
        }

        if (targetEndpoints.length === 0) {
            addLog('Tidak ada endpoint yang bisa disinkronkan untuk cakupan ini.', 'error');
            return;
        }

        cancelled.current = false;
        setRangeSyncConfig((prev) => ({ ...prev, isSyncing: true }));
        setLogs([]);
        setStats([]);
        setProgress(0);

        const scopeLabel = SCOPES.find((s) => s.id === activeScope)!.label;
        addLog(`MEMULAI BATCH SYNC ${scopeLabel} [${start}-${end}] · ${targetEndpoints.length} endpoint`, 'info');

        const totalSteps = (end - start + 1) * targetEndpoints.length;
        let completedSteps = 0;

        try {
            for (let y = start; y <= end && !cancelled.current; y++) {
                const yearStr = String(y);
                setRangeSyncConfig((prev) => ({ ...prev, currentYear: yearStr }));
                addLog(`--- TAHUN ${yearStr} ---`, 'info');

                for (const ep of targetEndpoints) {
                    if (cancelled.current) break;
                    await syncEndpoint(ep, yearStr, true);
                    completedSteps++;
                    setProgress(Math.round((completedSteps / totalSteps) * 100));
                }
            }

            addLog(cancelled.current ? 'BATCH SYNC DIHENTIKAN' : 'BATCH SYNC SELESAI', cancelled.current ? 'info' : 'success');
        } finally {
            setRangeSyncConfig((prev) => ({ ...prev, isSyncing: false, currentYear: null }));
            cancelled.current = false;
        }
    }, [rangeSyncConfig.startYear, rangeSyncConfig.endYear, targetEndpoints, activeScope, addLog, syncEndpoint]);

    const totalNewRows = stats.reduce((acc, curr) => acc + curr.newRecords, 0);
    const totalProcessed = stats.length;
    const errors = stats.filter(s => s.status === 'error').length;

    return (
        <FadeIn className="space-y-6">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 px-2">
                <div className="flex items-center gap-4">
                    <div className="h-14 w-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20 shadow-inner">
                        <History className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-extrabold tracking-tight">Range Sync Manager</h2>
                        <p className="text-muted-foreground font-medium text-sm mt-1">Batch download and synchronize master data across multiple years</p>
                    </div>
                </div>
            </div>

            {/* Workspace Area */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                
                {/* Configuration Panel */}
                <div className="xl:col-span-5 rounded-[2.5rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl p-8 flex flex-col gap-8">
                    
                    {/* Scope Selector */}
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Cakupan Sinkronisasi</label>
                        <div className="flex gap-2 p-1.5 bg-secondary/50 rounded-[1.5rem] border border-border/50 w-full shadow-inner">
                            {SCOPES.map((scope) => (
                                <Button
                                    key={scope.id}
                                    variant="ghost"
                                    disabled={rangeSyncConfig.isSyncing}
                                    className={cn(
                                        "flex-1 transition-all rounded-xl text-xs sm:text-sm font-bold h-12",
                                        activeScope === scope.id
                                            ? scope.id === 'legacy'
                                                ? "bg-background text-amber-600 dark:text-amber-500 shadow-sm"
                                                : "bg-background text-primary shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                    onClick={() => setActiveScope(scope.id)}
                                >
                                    {scope.label}
                                </Button>
                            ))}
                        </div>

                        <div className={cn(
                            "text-sm p-4 rounded-2xl border transition-all duration-300 shadow-inner",
                            activeScope === 'legacy'
                                ? "bg-amber-500/5 text-amber-700 dark:text-amber-300 border-amber-500/20"
                                : "bg-blue-500/5 text-blue-700 dark:text-blue-300 border-blue-500/20"
                        )}>
                            <div className="flex items-start gap-3">
                                {activeScope === 'legacy'
                                    ? <FileSpreadsheet className="h-5 w-5 shrink-0 mt-0.5" />
                                    : <Zap className="h-5 w-5 shrink-0 mt-0.5" />}
                                <div>
                                    <span className="font-extrabold block mb-1">
                                        {activeScope === 'legacy' ? 'Overwrite Sync' : 'Incremental Sync'}
                                        <span className="font-medium opacity-70"> · {targetEndpoints.length} endpoint</span>
                                    </span>
                                    <span className="opacity-90 leading-relaxed font-medium">
                                        {activeScope === 'legacy'
                                            ? 'Endpoint legacy mengirim seluruh dataset sekaligus, jadi file lama digantikan penuh.'
                                            : 'Menggunakan cursor untuk mengambil hanya data baru sejak sinkronisasi terakhir.'}
                                        {' '}Hasilnya ditulis sebagai JSON, CSV, dan XLSX.
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Year Range */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">From Year</label>
                            <Select value={rangeSyncConfig.startYear} onValueChange={(v) => setRangeSyncConfig(prev => ({ ...prev, startYear: v }))}>
                                <SelectTrigger className="w-full h-14 rounded-2xl border-border/50 bg-background/50 hover:bg-background shadow-sm text-lg font-bold px-5 focus:ring-4 focus:ring-primary/10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl shadow-xl">
                                    {Array.from({ length: 2027 - 2018 + 1 }, (_, i) => 2027 - i).map((y) => (
                                        <SelectItem key={y} value={String(y)} className="rounded-xl font-medium">{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">To Year</label>
                            <Select value={rangeSyncConfig.endYear} onValueChange={(v) => setRangeSyncConfig(prev => ({ ...prev, endYear: v }))}>
                                <SelectTrigger className="w-full h-14 rounded-2xl border-border/50 bg-background/50 hover:bg-background shadow-sm text-lg font-bold px-5 focus:ring-4 focus:ring-primary/10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl shadow-xl">
                                    {Array.from({ length: 2027 - 2018 + 1 }, (_, i) => 2027 - i).map((y) => (
                                        <SelectItem key={y} value={String(y)} className="rounded-xl font-medium">{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    
                    {/* Advanced Options */}
                    <div className="flex items-start space-x-3 bg-background/30 p-4 rounded-2xl border border-border/50 shadow-inner">
                        <input
                            type="checkbox"
                            id="forceSync"
                            checked={rangeSyncConfig.forceSync}
                            disabled={rangeSyncConfig.isSyncing}
                            onChange={(e) => setRangeSyncConfig(prev => ({ ...prev, forceSync: e.target.checked }))}
                            className="w-5 h-5 mt-0.5 rounded border-border/50 text-emerald-500 focus:ring-emerald-500/20 bg-background/50 cursor-pointer accent-emerald-500"
                        />
                        <div className="space-y-1.5 leading-none">
                            <label htmlFor="forceSync" className="text-sm font-bold cursor-pointer text-foreground block">Force Full Resync</label>
                            <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                                Hapus file lokal (JSON, CSV, XLSX) dan abaikan cursor. Mengambil semuanya dari awal.
                            </p>
                        </div>
                    </div>

                    <Button
                        size="lg"
                        className={cn(
                            "w-full h-16 text-lg font-extrabold shadow-xl rounded-2xl transition-all mt-auto",
                            rangeSyncConfig.isSyncing
                                ? "bg-secondary text-secondary-foreground"
                                : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                        onClick={rangeSyncConfig.isSyncing ? () => { cancelled.current = true; } : handleRangeSync}
                        disabled={targetEndpoints.length === 0}
                    >
                        {rangeSyncConfig.isSyncing ? (
                            <>
                                <Square className="h-5 w-5 mr-3" />
                                Hentikan Batch Sync
                            </>
                        ) : (
                            <>
                                <Zap className="h-6 w-6 mr-3" />
                                Mulai Range Sync
                            </>
                        )}
                    </Button>
                </div>

                {/* Minimalist Logs Panel */}
                <div className="xl:col-span-7 rounded-[2.5rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl flex flex-col overflow-hidden relative">
                    {/* Top Bar */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-background/30">
                        <div className="flex items-center gap-2">
                            <Activity className="h-5 w-5 text-primary" />
                            <span className="text-sm font-extrabold text-foreground tracking-wide">Operation Logs</span>
                        </div>
                    </div>

                    <div className="flex-1 p-6 sm:p-8 flex flex-col gap-6 relative z-10">
                        {/* Real-time Status */}
                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Global Progress</span>
                                <span className={cn("text-3xl font-black", rangeSyncConfig.isSyncing ? "text-primary" : "text-muted-foreground/50")}>
                                    {progress}%
                                </span>
                            </div>
                            <Progress value={progress} className={cn("h-3 bg-secondary", rangeSyncConfig.isSyncing && "[&>div]:bg-primary [&>div]:shadow-[0_0_15px_rgba(16,185,129,0.5)]")} />
                            
                            {rangeSyncConfig.isSyncing && (
                                <div className="text-sm text-primary font-bold flex items-center gap-2 mt-2">
                                    <Activity className="h-4 w-4 animate-pulse" />
                                    <span>
                                        Memproses: {syncingEndpoint ? getEndpoint(syncingEndpoint)?.label ?? syncingEndpoint : '—'}
                                        <span className="text-muted-foreground/30 mx-2">|</span>
                                        Tahun: <span className="text-foreground">{rangeSyncConfig.currentYear}</span>
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Logs Stream */}
                        <ScrollArea className="h-[250px] sm:h-[300px] w-full -mx-2 px-2">
                            <div className="space-y-2 pb-4 font-mono">
                                {logs.length === 0 ? (
                                    <div className="text-muted-foreground/50 text-sm mt-4 font-medium italic">Waiting for execution command...</div>
                                ) : (
                                    logs.map((log, i) => (
                                        <div key={i} className="flex gap-4 text-xs sm:text-[13px] leading-relaxed p-2.5 rounded-xl hover:bg-background/60 transition-colors">
                                            <span className="text-muted-foreground/50 shrink-0 font-medium">{log.time}</span>
                                            <span className={cn(
                                                "break-words",
                                                log.type === 'success' ? "text-emerald-600 dark:text-emerald-400 font-bold" :
                                                log.type === 'error' ? "text-rose-600 dark:text-rose-400 font-bold" :
                                                "text-foreground/80 font-medium"
                                            )}>
                                                {log.msg}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Ambient Glow */}
                    {rangeSyncConfig.isSyncing && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/10 blur-[100px] pointer-events-none" />
                    )}
                </div>
            </div>

            {/* Scorechart / Stats Panel */}
            {(stats.length > 0 || rangeSyncConfig.isSyncing) && (
                <SlideUp className="grid gap-6 md:grid-cols-12 pt-6">
                    {/* Summary Cards */}
                    <StaggerContainer className="md:col-span-4 lg:col-span-3 space-y-4" delayChildren={0.1}>
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Session Output</h3>
                        <div className="space-y-4">
                            <StaggerItem>
                                <ScaleOnHover className="h-full">
                                    <div className="p-6 rounded-[2rem] bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 text-emerald-900 dark:text-emerald-100 relative overflow-hidden group shadow-lg">
                                        <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                        <p className="text-xs font-extrabold uppercase tracking-widest opacity-70 mb-2 relative z-10">Total New Rows</p>
                                        <p className="text-5xl font-black tracking-tight relative z-10">{totalNewRows.toLocaleString()}</p>
                                        <Database className="absolute bottom-[-20px] right-[-20px] h-32 w-32 text-emerald-500/10 rotate-[-15deg] group-hover:scale-110 transition-transform duration-700" />
                                    </div>
                                </ScaleOnHover>
                            </StaggerItem>
                            <div className="grid grid-cols-2 gap-4">
                                <StaggerItem>
                                    <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 shadow-inner">
                                        <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">Processed</p>
                                        <p className="text-2xl font-black mt-1">{totalProcessed}</p>
                                    </div>
                                </StaggerItem>
                                <StaggerItem>
                                    <div className={cn(
                                        "p-4 rounded-2xl border shadow-inner transition-colors",
                                        errors > 0
                                            ? "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400 font-bold"
                                            : "bg-rose-500/5 border-rose-500/10 text-rose-600/70 dark:text-rose-400/70"
                                    )}>
                                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Errors</p>
                                        <p className="text-2xl font-black mt-1">{errors}</p>
                                    </div>
                                </StaggerItem>
                            </div>
                        </div>
                    </StaggerContainer>

                    {/* Detailed Borderless Table */}
                    <div className="md:col-span-8 lg:col-span-9 flex flex-col">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4 pl-1">Detailed Breakdown</h3>
                        <div className="rounded-[2.5rem] border border-border/50 bg-card/40 backdrop-blur-xl overflow-hidden flex flex-col h-full shadow-xl">
                            <ScrollArea className="h-[350px] w-full p-4">
                                <table className="w-full text-sm text-left border-collapse">
                                    <thead className="text-xs text-muted-foreground font-bold uppercase tracking-widest border-b border-border/50">
                                        <tr>
                                            <th className="px-6 py-4">Endpoint</th>
                                            <th className="px-6 py-4 w-[100px]">Year</th>
                                            <th className="px-6 py-4 text-right w-[150px]">New Rows</th>
                                            <th className="px-6 py-4 text-right">
                                                {activeScope === 'legacy' ? 'Total Baris' : 'Duplikat Dilewati'}
                                            </th>
                                            <th className="px-6 py-4 w-[100px] text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30">
                                        {stats.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="py-16 text-center text-muted-foreground font-medium">
                                                    Waiting for sync data...
                                                </td>
                                            </tr>
                                        ) : (
                                            stats.map((row, i) => (
                                                <tr key={i} className={cn("group hover:bg-background/80 transition-colors", row.newRecords > 0 ? "bg-emerald-500/[0.02]" : "")}>
                                                    <td className="px-6 py-4 truncate max-w-[200px]">
                                                        <span className="font-extrabold text-foreground">{row.endpoint.replace('Legacy:', '').replace('(Archive)', '').trim()}</span>
                                                    </td>
                                                    <td className="px-6 py-4 text-muted-foreground font-mono font-medium">{row.year}</td>
                                                    <td className={cn("px-6 py-4 text-right font-black font-mono", row.newRecords > 0 ? "text-emerald-500" : "text-muted-foreground/50")}>
                                                        {row.newRecords > 0 ? `+${row.newRecords.toLocaleString()}` : '—'}
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-muted-foreground/70 font-mono text-xs font-medium">
                                                        {row.duplicatesOrTotal.toLocaleString()}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {row.status === 'success' ? (
                                                            <div className="flex justify-center">
                                                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 gap-1.5 pr-3"><CheckCircle2 className="h-3.5 w-3.5" /> OK</Badge>
                                                            </div>
                                                        ) : (
                                                            <div className="flex justify-center" title={row.message}>
                                                                <Badge variant="destructive" className="gap-1.5 pr-3"><AlertCircle className="h-3.5 w-3.5" /> ERR</Badge>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </ScrollArea>
                        </div>
                    </div>
                </SlideUp>
            )}
        </FadeIn>
    );
}
