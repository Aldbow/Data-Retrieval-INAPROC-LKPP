'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    RefreshCw,
    Download,
    CheckCircle,
    AlertCircle,
    Clock,
    FolderOpen,
    Zap,
    Server,
    Database,
    FileJson,
    FileSpreadsheet,
    FileText,
    Ban,
    RotateCw,
    Square,
} from 'lucide-react';
import { FadeIn } from './ui/motion-primitives';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type StorageFormat = 'json' | 'csv' | 'xlsx';

interface FormatInfo {
    exists: boolean;
    path: string;
    size: number;
}

interface YearStatus {
    year: string;
    lastSyncDate: string;
    totalRecords: number;
    incomplete: boolean;
    formats: Record<StorageFormat, FormatInfo>;
    derivedStale: boolean;
}

interface EndpointStatus {
    endpoint: string;
    label: string;
    generation: 'v1' | 'legacy';
    group: 'data' | 'dashboard';
    category: string;
    kind: 'dataset' | 'aggregate' | 'reference';
    status: 'ready' | 'requires-id' | 'needs-params' | 'unavailable';
    yearScoped: boolean;
    years: YearStatus[];
    lastSynced: string | null;
}

interface StatusResponse {
    endpoints: EndpointStatus[];
    basePath: string;
    kodeKlpd: string;
}

interface SyncProgress {
    status: 'syncing' | 'complete' | 'error' | 'skipped';
    records: number;
    message?: string;
}

/** Top-level sections, mirroring the registry's tree. */
const SECTIONS = [
    { id: 'v1-data', title: 'V1 · Data', match: (e: EndpointStatus) => e.generation === 'v1' && e.group === 'data' },
    { id: 'v1-dashboard', title: 'V1 · Dashboard', match: (e: EndpointStatus) => e.group === 'dashboard' },
    { id: 'legacy', title: 'Legacy', match: (e: EndpointStatus) => e.generation === 'legacy' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const ALL_CATEGORIES = 'Semua';
const FORMAT_ORDER: StorageFormat[] = ['json', 'csv', 'xlsx'];
const FORMAT_ICON: Record<StorageFormat, typeof FileJson> = {
    json: FileJson,
    csv: FileText,
    xlsx: FileSpreadsheet,
};

interface SyncManagerProps {
    year: string;
    onSyncComplete?: () => void;
    onYearChange: (year: string) => void;
}

export function SyncManager({ year, onSyncComplete, onYearChange }: SyncManagerProps) {
    const [syncing, setSyncing] = useState<string | null>(null);
    const [batchSyncing, setBatchSyncing] = useState(false);
    const [progress, setProgress] = useState<Record<string, SyncProgress>>({});
    const [activeSection, setActiveSection] = useState<SectionId>('v1-data');
    const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);

    /**
     * Cancellation flag for batch sync.
     *
     * A ref, not state: the batch loop reads this on every iteration, and a
     * state variable captured in the closure keeps its render-time value. The
     * previous `if (!batchSyncing) break` read `false` on the first iteration
     * and aborted the batch immediately, so the button did nothing at all.
     */
    const cancelBatch = useRef(false);

    const { data, isLoading, refetch, isRefetching } = useQuery<StatusResponse>({
        queryKey: ['sync-status'],
        queryFn: async () => {
            const res = await fetch('/api/sync/status?verify=false');
            if (!res.ok) throw new Error('Failed to fetch sync status');
            return res.json();
        },
        refetchInterval: 15_000,
    });

    const statuses = useMemo(() => data?.endpoints ?? [], [data]);
    const basePath = data?.basePath ?? '';
    const kodeKlpd = data?.kodeKlpd ?? '';
    const loading = isLoading || isRefetching;

    const refresh = useCallback(
        async (verify = false) => {
            if (verify) await fetch('/api/sync/status?verify=true').catch(() => undefined);
            await refetch();
        },
        [refetch],
    );

    useEffect(() => {
        setProgress({});
    }, [year]);

    // ---- grouping -------------------------------------------------------

    const sectionMembers = useMemo(() => {
        const section = SECTIONS.find((s) => s.id === activeSection)!;
        return statuses.filter(section.match);
    }, [statuses, activeSection]);

    const categories = useMemo(() => {
        const names = Array.from(new Set(sectionMembers.map((e) => e.category))).sort((a, b) =>
            a.localeCompare(b),
        );
        return [ALL_CATEGORIES, ...names];
    }, [sectionMembers]);

    /**
     * Category actually in force.
     *
     * Derived rather than corrected after the fact: sections do not share the
     * same categories, so switching section while one is selected left the
     * filter pointing at a category the new section does not have. Resetting it
     * from an effect meant one render with an empty list before the correction
     * landed, which read as the endpoints vanishing.
     */
    const effectiveCategory = categories.includes(activeCategory) ? activeCategory : ALL_CATEGORIES;

    const displayed = useMemo(
        () =>
            effectiveCategory === ALL_CATEGORIES
                ? sectionMembers
                : sectionMembers.filter((e) => e.category === effectiveCategory),
        [sectionMembers, effectiveCategory],
    );

    const sectionCounts = useMemo(() => {
        const counts = {} as Record<SectionId, number>;
        for (const section of SECTIONS) {
            counts[section.id] = statuses.filter(section.match).length;
        }
        return counts;
    }, [statuses]);

    // ---- sync -----------------------------------------------------------

    /**
     * Drive one endpoint to completion, one request per page batch.
     *
     * Bails out when the server reports `stalled` -- that means the request
     * made no progress and repeating it would loop forever.
     */
    const syncEndpoint = useCallback(
        async (endpoint: EndpointStatus, options: { silent?: boolean } = {}) => {
            if (endpoint.status !== 'ready') {
                setProgress((p) => ({
                    ...p,
                    [endpoint.endpoint]: { status: 'skipped', records: 0, message: 'Butuh parameter tambahan' },
                }));
                return;
            }

            setSyncing(endpoint.endpoint);
            setProgress((p) => ({ ...p, [endpoint.endpoint]: { status: 'syncing', records: 0 } }));

            try {
                let isComplete = false;
                let guard = 0;

                while (!isComplete && guard < 500 && !cancelBatch.current) {
                    guard++;

                    const res = await fetch('/api/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            endpoint: endpoint.endpoint,
                            year: endpoint.yearScoped ? year : undefined,
                            batchSize: 100,
                            maxPages: 50,
                        }),
                    });

                    const result = await res.json();
                    if (!res.ok || !result.success) {
                        throw new Error(result.error || `HTTP ${res.status}`);
                    }

                    isComplete = result.isComplete;

                    setProgress((p) => ({
                        ...p,
                        [endpoint.endpoint]: {
                            status: isComplete ? 'complete' : 'syncing',
                            records: result.totalRecords,
                            message: result.warning,
                        },
                    }));

                    if (result.stalled) {
                        throw new Error(result.warning || 'Sync berhenti tanpa kemajuan');
                    }

                    if (!isComplete) await new Promise((r) => setTimeout(r, 400));
                }

                if (!options.silent) {
                    await refresh(true);
                    toast.success(`${endpoint.label}: sinkronisasi selesai`);
                }
                onSyncComplete?.();
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Kesalahan tidak diketahui';
                setProgress((p) => ({
                    ...p,
                    [endpoint.endpoint]: { status: 'error', records: 0, message },
                }));
                if (!options.silent) toast.error(`${endpoint.label}: ${message}`);
            } finally {
                setSyncing(null);
            }
        },
        [year, refresh, onSyncComplete],
    );

    /** Sync exactly the endpoints currently visible, matching the button label. */
    const batchSync = useCallback(async () => {
        const targets = displayed.filter((e) => e.status === 'ready');

        if (targets.length === 0) {
            toast.info('Tidak ada endpoint yang bisa disinkronkan di tampilan ini');
            return;
        }

        cancelBatch.current = false;
        setBatchSyncing(true);
        toast.info(`Memulai batch sync untuk ${targets.length} endpoint`);

        try {
            for (const target of targets) {
                if (cancelBatch.current) break;
                await syncEndpoint(target, { silent: true });
            }
        } finally {
            setBatchSyncing(false);
            await refresh(true);
            toast[cancelBatch.current ? 'info' : 'success'](
                cancelBatch.current ? 'Batch sync dihentikan' : 'Batch sync selesai',
            );
            cancelBatch.current = false;
        }
    }, [displayed, syncEndpoint, refresh]);

    /** Rebuild csv/xlsx from the canonical json without re-fetching. */
    const materialize = useCallback(
        async (endpoint: EndpointStatus) => {
            const id = toast.loading(`Membuat ulang CSV/XLSX untuk ${endpoint.label}`);
            try {
                const res = await fetch('/api/sync/materialize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: endpoint.endpoint,
                        year: endpoint.yearScoped ? year : undefined,
                    }),
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

                toast.success(`${endpoint.label}: ${result.rowCount.toLocaleString('id-ID')} baris ditulis`, { id });
                await refresh();
            } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Gagal membuat ulang file', { id });
            }
        },
        [year, refresh],
    );

    // ---- rendering ------------------------------------------------------

    const formatDate = (value: string | null) => {
        if (!value) return 'Belum pernah';
        return new Date(value).toLocaleString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const yearFor = (endpoint: EndpointStatus): YearStatus | undefined =>
        endpoint.yearScoped
            ? endpoint.years.find((y) => y.year === year)
            : endpoint.years.find((y) => y.year === '_all');

    const renderBadge = (endpoint: EndpointStatus) => {
        const current = progress[endpoint.endpoint];

        if (current?.status === 'syncing') {
            return (
                <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-500 animate-pulse border-blue-500/20 rounded-full font-medium">
                    <Loader2 className="h-3 w-3 animate-spin" /> Syncing
                </Badge>
            );
        }
        if (current?.status === 'error') {
            return (
                <Badge variant="destructive" className="gap-1 rounded-full" title={current.message}>
                    <AlertCircle className="h-3 w-3" /> Error
                </Badge>
            );
        }
        if (endpoint.status !== 'ready') {
            return (
                <Badge
                    variant="outline"
                    className="gap-1.5 rounded-full border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 font-medium"
                    title={
                        endpoint.status === 'requires-id'
                            ? 'Endpoint ini butuh ID spesifik (kd_penyedia, kd_komoditas, ...)'
                            : endpoint.status === 'unavailable'
                                ? 'Endpoint ini tidak tersedia di API (HTTP 404)'
                                : 'API menolak semua kombinasi parameter yang diketahui (HTTP 400)'
                    }
                >
                    <Ban className="h-3 w-3" />
                    {endpoint.status === 'requires-id'
                        ? 'Butuh ID'
                        : endpoint.status === 'unavailable'
                            ? 'Tidak Tersedia'
                            : 'Butuh Parameter'}
                </Badge>
            );
        }

        const state = yearFor(endpoint);
        if (state) {
            return (
                <Badge
                    suppressHydrationWarning
                    variant="outline"
                    className={cn(
                        'gap-1.5 rounded-full font-mono',
                        state.incomplete
                            ? 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5'
                            : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
                    )}
                >
                    <CheckCircle className="h-3 w-3" />
                    {state.incomplete ? 'Sebagian' : 'Siap'} ({state.totalRecords.toLocaleString('id-ID')})
                </Badge>
            );
        }

        return (
            <Badge variant="outline" className="text-muted-foreground/60 border-dashed rounded-full font-medium border-muted-foreground/30">
                Perlu Sync
            </Badge>
        );
    };

    /** Which of the three formats exist on disk for the selected year. */
    const renderFormats = (endpoint: EndpointStatus) => {
        const state = yearFor(endpoint);
        if (!state) return null;

        return (
            <div className="flex items-center gap-1.5">
                {FORMAT_ORDER.map((format) => {
                    const info = state.formats[format];
                    const Icon = FORMAT_ICON[format];
                    return (
                        <Tooltip key={format}>
                            <TooltipTrigger asChild>
                                <span
                                    className={cn(
                                        'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase border transition-colors',
                                        info?.exists
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                            : 'bg-muted/40 text-muted-foreground/50 border-dashed border-muted-foreground/20',
                                    )}
                                >
                                    <Icon className="h-3 w-3" />
                                    {format}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="rounded-xl font-medium">
                                {info?.exists
                                    ? `${format.toUpperCase()} · ${(info.size / 1024).toLocaleString('id-ID', { maximumFractionDigits: 0 })} KB`
                                    : `${format.toUpperCase()} belum dibuat`}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
                {state.derivedStale && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                <AlertCircle className="h-3 w-3" /> Stale
                            </span>
                        </TooltipTrigger>
                        <TooltipContent className="rounded-xl font-medium">
                            CSV/XLSX lebih lama dari JSON kanonik — klik ikon regenerate
                        </TooltipContent>
                    </Tooltip>
                )}
            </div>
        );
    };

    return (
        <TooltipProvider>
            <FadeIn className="space-y-6">
                {/* Control bar */}
                <div className="relative overflow-hidden rounded-[2.5rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 sm:p-10">
                    <div className="absolute -top-12 -right-12 p-8 opacity-[0.03] pointer-events-none">
                        <Server className="w-64 h-64 text-primary" />
                    </div>

                    <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary shadow-inner">
                                    <Server className="w-6 h-6" />
                                </div>
                                <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Sync Configuration</h3>
                            </div>
                            <p className="text-muted-foreground font-medium text-sm ml-1">
                                Setiap dataset disimpan sebagai JSON, CSV, dan XLSX sekaligus
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center p-1.5 bg-secondary/50 rounded-full border border-border/50 shadow-sm">
                                <Select value={year} onValueChange={onYearChange}>
                                    <SelectTrigger className="w-[110px] h-10 border-none bg-transparent shadow-none focus:ring-0 font-bold">
                                        <SelectValue placeholder="Tahun" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl">
                                        {Array.from({ length: 2027 - 2018 + 1 }, (_, i) => 2027 - i).map((y) => (
                                            <SelectItem key={y} value={String(y)} className="rounded-xl font-medium cursor-pointer">
                                                {y}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => refresh(true)}
                                disabled={loading}
                                className="h-14 w-14 rounded-full border-border/50 bg-background/50 shadow-sm hover:bg-secondary"
                            >
                                <RefreshCw className={cn('h-5 w-5 text-muted-foreground', loading && 'animate-spin text-primary')} />
                            </Button>

                            {batchSyncing ? (
                                <Button
                                    size="lg"
                                    variant="secondary"
                                    onClick={() => {
                                        cancelBatch.current = true;
                                    }}
                                    className="h-14 px-8 rounded-full gap-3 font-semibold"
                                >
                                    <Square className="h-4 w-4" /> Hentikan Batch
                                </Button>
                            ) : (
                                <Button
                                    size="lg"
                                    onClick={batchSync}
                                    disabled={syncing !== null}
                                    className="h-14 px-8 rounded-full gap-3 shadow-xl shadow-primary/25 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-base font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                                >
                                    <Zap className="h-5 w-5" />
                                    Sync {displayed.filter((e) => e.status === 'ready').length} Endpoint Terlihat
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Endpoint grid */}
                <div className="rounded-[2.5rem] border border-border/50 bg-card/30 backdrop-blur-xl shadow-xl overflow-hidden p-6 sm:p-10">
                    <div className="flex flex-col gap-6 mb-8 border-b border-border/50 pb-8">
                        <div className="flex gap-2 p-1.5 bg-secondary/50 rounded-2xl border border-border/50 w-max shadow-inner overflow-x-auto max-w-full">
                            {SECTIONS.map((section) => (
                                <Button
                                    key={section.id}
                                    variant="ghost"
                                    className={cn(
                                        'rounded-[0.85rem] px-6 h-12 text-sm font-bold whitespace-nowrap transition-all',
                                        activeSection === section.id
                                            ? 'bg-background shadow-sm text-primary'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                    onClick={() => setActiveSection(section.id)}
                                >
                                    {section.title}
                                    <Badge variant="secondary" className="ml-2 bg-secondary/80 text-[10px] h-5 px-1.5 font-bold">
                                        {sectionCounts[section.id] ?? 0}
                                    </Badge>
                                </Button>
                            ))}
                        </div>

                        <div className="flex gap-2 p-1.5 bg-secondary/50 rounded-full border border-border/50 overflow-x-auto w-full scrollbar-none shadow-inner">
                            {categories.map((category) => (
                                <Button
                                    key={category}
                                    variant="ghost"
                                    className={cn(
                                        'rounded-full px-5 h-10 text-xs font-semibold whitespace-nowrap transition-all',
                                        effectiveCategory === category
                                            ? 'bg-background shadow-sm text-foreground'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                    onClick={() => setActiveCategory(category)}
                                >
                                    {category}
                                    <Badge variant="secondary" className="ml-2 bg-secondary/80 text-[10px] h-5 px-1.5 font-bold">
                                        {category === ALL_CATEGORIES
                                            ? sectionMembers.length
                                            : sectionMembers.filter((e) => e.category === category).length}
                                    </Badge>
                                </Button>
                            ))}
                        </div>
                    </div>

                    <ScrollArea className="h-[550px] pr-4">
                        {loading && statuses.length === 0 ? (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                {[1, 2, 3, 4].map((i) => (
                                    <Skeleton key={i} className="h-32 w-full rounded-3xl" />
                                ))}
                            </div>
                        ) : displayed.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[400px] text-center gap-4">
                                <div className="h-24 w-24 bg-muted/30 rounded-[2rem] flex items-center justify-center">
                                    <Database className="h-10 w-10 text-muted-foreground opacity-50" />
                                </div>
                                <h3 className="text-xl font-bold">Tidak ada endpoint</h3>
                                <p className="text-muted-foreground">Coba pilih kategori atau bagian lain.</p>
                            </div>
                        ) : (
                            /*
                             * Rendered without a stagger animation on purpose. A per-item
                             * delay meant the last of 39 Legacy endpoints only appeared
                             * after ~2s, restarting on every section switch, so the list
                             * spent most of its time invisible.
                             */
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pb-4">
                                {displayed.map((endpoint) => {
                                    const state = yearFor(endpoint);
                                    const isSyncingThis = syncing === endpoint.endpoint;
                                    const current = progress[endpoint.endpoint];

                                    return (
                                        <div key={endpoint.endpoint}>
                                            <div
                                                className={cn(
                                                    'group relative flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-[2rem] border bg-background/50 hover:bg-card hover:shadow-xl transition-all duration-300 gap-5 overflow-hidden',
                                                    isSyncingThis
                                                        ? 'border-primary/50 shadow-lg shadow-primary/10 ring-1 ring-primary/20 bg-primary/5'
                                                        : 'border-border/50 shadow-sm hover:border-primary/20',
                                                )}
                                            >
                                                <div className="flex-1 min-w-0 z-10">
                                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                                        <div className="h-8 w-8 bg-secondary/80 rounded-xl flex items-center justify-center border border-border/50 shadow-inner text-foreground/70">
                                                            <FileJson className="h-4 w-4" />
                                                        </div>
                                                        <span className="font-extrabold text-sm truncate text-foreground/90">
                                                            {endpoint.label}
                                                        </span>
                                                        {endpoint.kind === 'aggregate' && (
                                                            <Badge variant="secondary" className="text-[9px] uppercase font-bold rounded-md px-1.5">
                                                                Snapshot
                                                            </Badge>
                                                        )}
                                                        {!endpoint.yearScoped && (
                                                            <Badge variant="secondary" className="text-[9px] uppercase font-bold rounded-md px-1.5">
                                                                Non-tahunan
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-col gap-2 mt-3 sm:pl-[44px]">
                                                        <div className="flex flex-wrap items-center gap-2">{renderBadge(endpoint)}</div>

                                                        {renderFormats(endpoint)}

                                                        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground/80 mt-1">
                                                            {state && (
                                                                <span suppressHydrationWarning className="flex items-center gap-1.5 bg-secondary/50 px-2 py-1 rounded-md">
                                                                    <Clock className="h-3 w-3" />
                                                                    {formatDate(state.lastSyncDate)}
                                                                </span>
                                                            )}
                                                            {current?.message && (
                                                                <span className="text-amber-600 dark:text-amber-400 truncate max-w-[280px]" title={current.message}>
                                                                    {current.message}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="z-10 flex shrink-0 sm:self-center gap-2 mt-2 sm:mt-0">
                                                    {state?.derivedStale && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    onClick={() => materialize(endpoint)}
                                                                    className="h-14 w-14 rounded-full border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 hover:bg-amber-500/15"
                                                                >
                                                                    <RotateCw className="h-5 w-5" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="rounded-xl font-medium">
                                                                Buat ulang CSV/XLSX dari JSON
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}

                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant={isSyncingThis ? 'secondary' : 'outline'}
                                                                size="icon"
                                                                onClick={() => syncEndpoint(endpoint)}
                                                                disabled={syncing !== null || batchSyncing || endpoint.status !== 'ready'}
                                                                className={cn(
                                                                    'h-14 w-14 rounded-full border-border/50 bg-background hover:bg-primary hover:text-primary-foreground hover:border-transparent transition-all shadow-sm disabled:opacity-40',
                                                                    isSyncingThis && 'bg-primary/10 text-primary border-primary/20',
                                                                )}
                                                            >
                                                                {isSyncingThis ? (
                                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                                ) : endpoint.status !== 'ready' ? (
                                                                    <Ban className="h-5 w-5" />
                                                                ) : (
                                                                    <Download className="h-5 w-5" />
                                                                )}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="rounded-xl font-medium">
                                                            {endpoint.status === 'ready'
                                                                ? 'Mulai sinkronisasi'
                                                                : 'Endpoint ini belum bisa disinkronkan'}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </ScrollArea>

                    <div className="mt-6 pt-6 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-muted-foreground/70">
                        <div className="flex items-center gap-2.5 bg-background/50 px-4 py-2 rounded-xl border border-border/50 shadow-inner">
                            <FolderOpen className="h-4 w-4 text-primary/60" />
                            <span>
                                Storage Root: <strong className="text-foreground/80 ml-1">{basePath || 'Memuat...'}</strong>
                            </span>
                        </div>
                        {kodeKlpd && (
                            <div className="flex items-center gap-2.5 bg-background/50 px-4 py-2 rounded-xl border border-border/50 shadow-inner">
                                <Database className="h-4 w-4 text-primary/60" />
                                <span>
                                    KLPD: <strong className="text-foreground/80 ml-1">{kodeKlpd}</strong>
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </FadeIn>
        </TooltipProvider>
    );
}
