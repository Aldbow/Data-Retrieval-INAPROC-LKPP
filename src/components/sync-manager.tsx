'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
    PlayCircle,
    PauseCircle,
    Database,
    FileJson,
    Calendar,
    Settings2
} from 'lucide-react';
import { getSyncableEndpoints } from '@/lib/constants';
import { FadeIn, StaggerContainer, StaggerItem } from './ui/motion-primitives';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';

interface SyncState {
    lastCursor: string | null;
    lastSyncDate: string;
    totalRecords: number;
    filePath: string;
}

interface EndpointStatus {
    endpoint: string;
    label: string;
    years: { year: string; state: SyncState }[];
    lastSynced: string | null;
}

interface ScheduleConfig {
    enabled: boolean;
    type: 'daily' | 'weekly';
    lastRun: string | null;
    endpoints: string[];
}

interface SyncManagerProps {
    year: string;
    onSyncComplete?: () => void;
    onYearChange: (year: string) => void;
}

export function SyncManager({ year, onSyncComplete, onYearChange }: SyncManagerProps) {
    const [syncing, setSyncing] = useState<string | null>(null);
    const [batchSyncing, setBatchSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState<Record<string, { status: string; records: number }>>({});

    const [activeVersionTab, setActiveVersionTab] = useState<'V1' | 'Legacy'>('V1');
    const [activeCategoryTab, setActiveCategoryTab] = useState<string>('Semua');

    const { data: statusData, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ['sync-status'],
        queryFn: async () => {
            const res = await fetch(`/api/sync/status?verify=false`);
            if (!res.ok) throw new Error("Failed to fetch sync status");
            return res.json();
        },
        refetchInterval: 10000 // Poll every 10 seconds
    });

    const statuses = statusData?.endpoints || [];
    const schedule = statusData?.schedule || null;
    const basePath = statusData?.basePath || '';
    const loading = isLoading || isRefetching;

    const fetchStatus = useCallback(async (verify = false) => {
        if (verify) {
            const res = await fetch(`/api/sync/status?verify=true`);
            if (res.ok) await refetch();
        } else {
            await refetch();
        }
    }, [refetch]);

    useEffect(() => {
        setSyncProgress({});
    }, [year]);

    const syncEndpoint = async (endpoint: string) => {
        setSyncing(endpoint);
        setSyncProgress((prev) => ({
            ...prev,
            [endpoint]: { status: 'syncing', records: 0 },
        }));

        try {
            let isComplete = false;
            while (!isComplete) {
                const res = await fetch('/api/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint,
                        year,
                        batchSize: 100,
                        maxPages: 50,
                    }),
                });

                const result = await res.json();
                if (!result.success) throw new Error(result.error || 'Sync failed');

                isComplete = result.isComplete;
                setSyncProgress((prev) => ({
                    ...prev,
                    [endpoint]: {
                        status: isComplete ? 'complete' : 'syncing',
                        records: result.totalRecords,
                    },
                }));

                if (!isComplete) await new Promise((r) => setTimeout(r, 500));
            }

            if (!batchSyncing) {
                await fetchStatus(true);
                toast.success(`Sync completed!`);
            }
            onSyncComplete?.();
        } catch (error: any) {
            setSyncProgress((prev) => ({
                ...prev,
                [endpoint]: { status: 'error', records: 0 },
            }));
            toast.error(`Sync failed`);
        } finally {
            setSyncing(null);
        }
    };

    const batchSync = async () => {
        setBatchSyncing(true);
        const syncableEndpoints = getSyncableEndpoints();
        toast.info("Starting batch sync...");
        for (const ep of syncableEndpoints) {
            if (!batchSyncing) break;
            await syncEndpoint(ep.value);
        }
        setBatchSyncing(false);
        await fetchStatus(true);
    };

    const updateSchedule = async (updates: Partial<ScheduleConfig>) => {
        try {
            const res = await fetch('/api/sync/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            await res.json();
            refetch();
            toast.success("Schedule updated");
        } catch (error) {
            toast.error("Failed to update schedule");
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const getStatusInfo = (endpoint: string, status: EndpointStatus) => {
        const progress = syncProgress[endpoint];
        if (progress?.status === 'syncing') {
            return { color: 'bg-blue-500 text-white', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Syncing', pulse: true };
        }
        if (progress?.status === 'complete') {
            return { color: 'bg-emerald-500 text-white', icon: <CheckCircle className="h-3 w-3" />, label: 'Complete', pulse: false };
        }
        if (progress?.status === 'error') {
            return { color: 'bg-red-500 text-white', icon: <AlertCircle className="h-3 w-3" />, label: 'Error', pulse: false };
        }
        const yearState = status.years.find((y) => y.year === year);
        if (yearState) {
            return { color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: <CheckCircle className="h-3 w-3" />, label: 'Ready', pulse: false };
        }
        return { color: 'bg-muted text-muted-foreground', icon: <AlertCircle className="h-3 w-3" />, label: 'Unsynced', pulse: false };
    };

    const groupedStatuses = useMemo(() => {
        return statuses.reduce((acc, status) => {
            const version = status.endpoint.startsWith('/legacy') ? 'Legacy' : 'V1';
            let category = 'Lainnya';
            if (status.endpoint.includes('ekatalog')) category = 'E-Katalog';
            else if (status.endpoint.includes('rup')) category = 'RUP';
            else if (status.endpoint.includes('tender')) category = 'Tender';

            if (!acc[version]) acc[version] = { 'Semua': [] };
            if (!acc[version][category]) acc[version][category] = [];

            acc[version][category].push(status);
            acc[version]['Semua'].push(status);

            return acc;
        }, {} as Record<string, Record<string, EndpointStatus[]>>);
    }, [statuses]);

    const categoriesForVersion = useMemo(() => {
        if (!groupedStatuses[activeVersionTab]) return ['Semua'];
        return Object.keys(groupedStatuses[activeVersionTab]).sort((a, b) => a === 'Semua' ? -1 : b === 'Semua' ? 1 : a.localeCompare(b));
    }, [groupedStatuses, activeVersionTab]);

    useEffect(() => {
        if (!categoriesForVersion.includes(activeCategoryTab)) {
            setActiveCategoryTab('Semua');
        }
    }, [activeVersionTab, categoriesForVersion, activeCategoryTab]);

    const displayedEndpoints = useMemo(() => {
        if (!groupedStatuses[activeVersionTab]) return [];
        return groupedStatuses[activeVersionTab][activeCategoryTab] || [];
    }, [groupedStatuses, activeVersionTab, activeCategoryTab]);

    return (
        <FadeIn className="space-y-6">
            {/* Header Control Panel */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 p-5 sm:p-6 rounded-[2rem] bg-card/60 backdrop-blur-xl border border-border shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 text-primary rounded-2xl shadow-inner">
                        <Database className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">Sync Configuration</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">Manage and synchronize master data</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                    {/* Automation Control */}
                    <div className="flex items-center p-1.5 bg-background rounded-full border border-border shadow-sm mr-auto lg:mr-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateSchedule({ enabled: !schedule?.enabled })}
                            className={cn(
                                "h-9 rounded-full px-4 text-xs font-bold transition-all",
                                schedule?.enabled ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                            )}
                        >
                            {schedule?.enabled ? (
                                <><PauseCircle className="h-4 w-4 mr-2" /> Auto: ON</>
                            ) : (
                                <><PlayCircle className="h-4 w-4 mr-2" /> Auto: OFF</>
                            )}
                        </Button>
                        <div className="w-px h-5 bg-border mx-1" />
                        <Select value={schedule?.type || 'daily'} onValueChange={(value) => updateSchedule({ type: value as 'daily' | 'weekly' })}>
                            <SelectTrigger className="h-9 border-none bg-transparent shadow-none focus:ring-0 text-xs font-semibold px-3">
                                <Settings2 className="w-4 h-4 mr-2 text-muted-foreground" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl shadow-xl">
                                <SelectItem value="daily" className="rounded-lg text-xs cursor-pointer">Daily</SelectItem>
                                <SelectItem value="weekly" className="rounded-lg text-xs cursor-pointer">Weekly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Year & Actions */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center p-1 bg-background rounded-full border border-border shadow-sm">
                            <Calendar className="w-4 h-4 ml-3 text-muted-foreground" />
                            <Select value={year} onValueChange={onYearChange}>
                                <SelectTrigger className="w-[100px] h-10 border-none bg-transparent shadow-none focus:ring-0 font-bold text-foreground">
                                    <SelectValue placeholder="Year" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl shadow-xl">
                                    {Array.from({ length: 2027 - 2018 + 1 }, (_, i) => 2027 - i).map((y) => (
                                        <SelectItem key={y} value={String(y)} className="rounded-lg font-medium cursor-pointer">{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => fetchStatus(true)}
                            disabled={loading}
                            className="h-12 w-12 rounded-full border-border bg-background shadow-sm hover:bg-secondary transition-all group"
                        >
                            <RefreshCw className={cn("h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors", loading && "animate-spin text-primary")} />
                        </Button>
                        <Button
                            onClick={batchSync}
                            disabled={batchSyncing || syncing !== null}
                            className="h-12 px-6 rounded-full gap-2 shadow-lg shadow-primary/25 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            {batchSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                            <span className="hidden sm:inline">{batchSyncing ? 'Syncing...' : 'Batch Sync'}</span>
                        </Button>
                    </div>
                </div>
            </div>

            {/* List Container */}
            <div className="flex flex-col border border-border rounded-[2rem] bg-card/40 backdrop-blur-xl shadow-xl overflow-hidden">
                
                {/* Tabs */}
                <div className="p-4 sm:px-6 border-b border-border bg-background/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex p-1 bg-secondary/60 rounded-xl border border-border/50 shadow-inner w-full sm:w-auto">
                        {(['V1', 'Legacy'] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setActiveVersionTab(v)}
                                className={cn(
                                    "flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-lg transition-all",
                                    activeVersionTab === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {v} API
                            </button>
                        ))}
                    </div>

                    <div className="flex p-1 bg-secondary/60 rounded-xl border border-border/50 overflow-x-auto w-full sm:w-auto scrollbar-none shadow-inner">
                        {categoriesForVersion.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategoryTab(cat)}
                                className={cn(
                                    "flex items-center px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all",
                                    activeCategoryTab === cat ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {cat}
                                <span className={cn(
                                    "ml-2 px-1.5 py-0.5 rounded-md text-[10px]",
                                    activeCategoryTab === cat ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                )}>
                                    {groupedStatuses[activeVersionTab]?.[cat]?.length || 0}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* List Content */}
                <ScrollArea className="h-[600px] w-full">
                    {loading && statuses.length === 0 ? (
                        <div className="p-6 space-y-4">
                            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
                        </div>
                    ) : displayedEndpoints.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[400px] text-center gap-4">
                            <Database className="h-12 w-12 text-muted-foreground opacity-30" />
                            <h3 className="text-lg font-bold text-foreground">No endpoints found</h3>
                            <p className="text-sm text-muted-foreground">Adjust your filters to see more endpoints.</p>
                        </div>
                    ) : (
                        <StaggerContainer key={`${activeVersionTab}-${activeCategoryTab}`} className="flex flex-col p-4 sm:p-6 gap-3">
                            {displayedEndpoints.map((status) => {
                                const yearState = status.years.find((y) => y.year === year);
                                const progress = syncProgress[status.endpoint];
                                const isSyncingThis = syncing === status.endpoint;
                                const statusInfo = getStatusInfo(status.endpoint, status);
                                
                                // Determine records to display
                                const displayRecords = isSyncingThis 
                                    ? progress?.records || 0
                                    : yearState?.state.totalRecords || 0;

                                return (
                                    <StaggerItem key={status.endpoint}>
                                        <div className={cn(
                                            "group relative flex flex-col md:flex-row md:items-center justify-between p-4 sm:p-5 rounded-2xl border transition-all duration-300 gap-5 overflow-hidden",
                                            isSyncingThis ? "bg-primary/5 border-primary/40 shadow-md ring-1 ring-primary/20" : "bg-background/80 border-border hover:border-primary/30 hover:shadow-md"
                                        )}>
                                            
                                            {/* Left: Info */}
                                            <div className="flex items-center gap-4 flex-1 min-w-0">
                                                <div className={cn(
                                                    "h-12 w-12 shrink-0 rounded-xl flex items-center justify-center shadow-inner transition-colors",
                                                    isSyncingThis ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground group-hover:text-foreground"
                                                )}>
                                                    <FileJson className="h-6 w-6" />
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <h4 className="font-bold text-sm sm:text-base text-foreground truncate" title={status.label}>
                                                        {status.label}
                                                    </h4>
                                                    <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                                                        {status.endpoint}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Middle: Status & Progress */}
                                            <div className="flex flex-row items-center gap-4 md:gap-6 flex-1 md:justify-end">
                                                
                                                {/* Status Badge */}
                                                <div className={cn(
                                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide uppercase shrink-0 shadow-sm",
                                                    statusInfo.color,
                                                    statusInfo.pulse && "animate-pulse"
                                                )}>
                                                    {statusInfo.icon}
                                                    {statusInfo.label}
                                                </div>

                                                {/* Stats */}
                                                <div className="flex flex-col items-end shrink-0 hidden sm:flex">
                                                    <span className="text-sm font-extrabold text-foreground font-mono">
                                                        {displayRecords.toLocaleString()} <span className="text-[10px] text-muted-foreground font-sans font-medium uppercase">Records</span>
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                                        <Clock className="w-3 h-3" />
                                                        {isSyncingThis ? 'Sync in progress...' : formatDate(yearState?.state.lastSyncDate || null)}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Mobile Stats (Visible only on small screens) */}
                                            <div className="flex items-center justify-between sm:hidden border-t border-border pt-3 mt-1">
                                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {isSyncingThis ? 'Syncing...' : formatDate(yearState?.state.lastSyncDate || null)}
                                                </span>
                                                <span className="text-xs font-extrabold text-foreground font-mono">
                                                    {displayRecords.toLocaleString()} recs
                                                </span>
                                            </div>

                                            {/* Right: Action Button */}
                                            <div className="shrink-0 absolute right-4 top-4 md:relative md:right-0 md:top-0">
                                                <Button
                                                    variant={isSyncingThis ? "secondary" : "outline"}
                                                    size="icon"
                                                    onClick={() => syncEndpoint(status.endpoint)}
                                                    disabled={syncing !== null || batchSyncing}
                                                    className={cn(
                                                        "h-10 w-10 md:h-12 md:w-12 rounded-full border-border bg-background hover:bg-primary hover:text-primary-foreground hover:border-transparent transition-all shadow-sm",
                                                        isSyncingThis && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                                                    )}
                                                >
                                                    {isSyncingThis ? (
                                                        <Loader2 className="h-5 w-5 animate-spin" />
                                                    ) : (
                                                        <Download className="h-5 w-5" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </StaggerItem>
                                );
                            })}
                        </StaggerContainer>
                    )}
                </ScrollArea>

                <div className="px-6 py-4 bg-secondary/30 border-t border-border flex items-center gap-2 text-xs font-mono text-muted-foreground">
                    <FolderOpen className="h-4 w-4" />
                    Storage: <span className="text-foreground/80 truncate">{basePath || 'Pending...'}</span>
                </div>
            </div>
        </FadeIn>
    );
}
