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
    Server,
    Database,
    FileJson
} from 'lucide-react';
import { ENDPOINTS, getSyncableEndpoints } from '@/lib/constants';
import { FadeIn, StaggerContainer, StaggerItem, ScaleOnHover } from './ui/motion-primitives';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

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
    const [statuses, setStatuses] = useState<EndpointStatus[]>([]);
    const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState<string | null>(null);
    const [batchSyncing, setBatchSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState<Record<string, { status: string; records: number }>>({});
    const [basePath, setBasePath] = useState<string>('');

    const [activeVersionTab, setActiveVersionTab] = useState<'V1' | 'Legacy'>('V1');
    const [activeCategoryTab, setActiveCategoryTab] = useState<string>('Semua');

    const fetchStatus = useCallback(async (verify = false) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/sync/status?verify=${verify}`);
            const data = await res.json();
            setStatuses(data.endpoints || []);
            setSchedule(data.schedule || null);
            setBasePath(data.basePath || '');
        } catch (error) {
            console.error('Failed to fetch status:', error);
            toast.error("Failed to fetch sync status");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus(false);
    }, [fetchStatus]);

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
            const data = await res.json();
            setSchedule(data.schedule);
            toast.success("Schedule updated");
        } catch (error) {
            toast.error("Failed to update schedule");
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never synced';
        const date = new Date(dateStr);
        return date.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const getStatusBadge = (endpoint: string, status: EndpointStatus) => {
        const progress = syncProgress[endpoint];
        if (progress?.status === 'syncing') {
            return <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-500 animate-pulse border-blue-500/20 rounded-full font-medium"><Loader2 className="h-3 w-3 animate-spin" /> Syncing</Badge>;
        }
        if (progress?.status === 'complete') {
            return <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20 rounded-full font-medium"><CheckCircle className="h-3 w-3" /> Complete</Badge>;
        }
        if (progress?.status === 'error') {
            return <Badge variant="destructive" className="gap-1 rounded-full"><AlertCircle className="h-3 w-3" /> Error</Badge>;
        }
        const yearState = status.years.find((y) => y.year === year);
        if (yearState) {
            return <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 rounded-full font-mono"><CheckCircle className="h-3 w-3" /> Ready ({yearState.state.totalRecords.toLocaleString()})</Badge>;
        }
        return <Badge variant="outline" className="text-muted-foreground/60 border-dashed rounded-full font-medium border-muted-foreground/30">Needs Sync</Badge>;
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
        return Object.keys(groupedStatuses[activeVersionTab]).sort((a,b) => a === 'Semua' ? -1 : b === 'Semua' ? 1 : a.localeCompare(b));
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
            {/* Top Control Bar (Bento style) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Hero / Controls */}
                <div className="lg:col-span-2 relative overflow-hidden rounded-[2.5rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 sm:p-10 flex flex-col justify-between group hover:border-primary/20 transition-all">
                    <div className="absolute -top-12 -right-12 p-8 opacity-[0.03] group-hover:opacity-10 transition-opacity pointer-events-none transform group-hover:scale-110 duration-700">
                        <Server className="w-64 h-64 text-primary" />
                    </div>
                    <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary shadow-inner">
                                    <Server className="w-6 h-6" />
                                </div>
                                <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Sync Configuration</h3>
                            </div>
                            <p className="text-muted-foreground font-medium text-sm ml-1">Download and synchronize master data locally</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center p-1.5 bg-secondary/50 rounded-full border border-border/50 shadow-sm">
                                <Select value={year} onValueChange={onYearChange}>
                                    <SelectTrigger className="w-[110px] h-10 border-none bg-transparent shadow-none focus:ring-0 font-bold text-foreground">
                                        <SelectValue placeholder="Year" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl">
                                        {Array.from({ length: 2026 - 2018 + 1 }, (_, i) => 2026 - i).map((y) => (
                                            <SelectItem key={y} value={String(y)} className="rounded-xl font-medium focus:bg-primary/10 focus:text-primary cursor-pointer">{y}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button variant="outline" size="icon" onClick={() => fetchStatus(true)} disabled={loading} className="h-14 w-14 rounded-full border-border/50 bg-background/50 shadow-sm hover:bg-secondary transition-all group/btn">
                                <RefreshCw className={cn("h-5 w-5 text-muted-foreground group-hover/btn:text-primary transition-colors", loading && "animate-spin text-primary")} />
                            </Button>
                        </div>
                    </div>

                    <div className="relative z-10 mt-auto">
                        <Button size="lg" onClick={batchSync} disabled={batchSyncing || syncing !== null} className="w-full sm:w-auto h-14 px-8 rounded-full gap-3 shadow-xl shadow-primary/25 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary text-primary-foreground text-base font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
                            {batchSyncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                            {batchSyncing ? 'Batch Syncing in Progress...' : 'Sync All Visible Endpoints'}
                        </Button>
                    </div>
                </div>

                {/* Schedule Widget */}
                <div className="relative overflow-hidden rounded-[2.5rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 sm:p-8 flex flex-col justify-between group hover:border-blue-500/20 transition-all">
                    <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-10 transition-opacity pointer-events-none transform group-hover:-rotate-12 duration-700">
                        <Clock className="w-48 h-48 text-blue-500" />
                    </div>
                    <div className="flex items-center justify-between mb-6 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-2xl bg-blue-500/10 text-blue-500 shadow-inner">
                                <Clock className="w-6 h-6" />
                            </div>
                            <h3 className="font-extrabold tracking-tight text-xl">Automation</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {schedule?.enabled && <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span></span>}
                        </div>
                    </div>
                    
                    <div className="space-y-5 relative z-10">
                        <div>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1.5 ml-1">Frequency</p>
                            <Select value={schedule?.type || 'daily'} onValueChange={(value) => updateSchedule({ type: value as 'daily' | 'weekly' })}>
                                <SelectTrigger className="w-full h-12 rounded-2xl border-border/50 bg-background/50 hover:bg-background shadow-sm text-sm font-semibold focus:ring-4 focus:ring-blue-500/10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl shadow-xl">
                                    <SelectItem value="daily" className="rounded-xl cursor-pointer">Daily Execution</SelectItem>
                                    <SelectItem value="weekly" className="rounded-xl cursor-pointer">Weekly Execution</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1.5 ml-1">Last Run</p>
                            <div className="font-mono text-sm bg-background/50 px-4 py-3 rounded-2xl border border-border/50 truncate font-medium text-foreground/80 shadow-inner">
                                {schedule?.lastRun ? formatDate(schedule.lastRun) : 'Never executed'}
                            </div>
                        </div>

                        <Button variant={schedule?.enabled ? 'secondary' : 'outline'} onClick={() => updateSchedule({ enabled: !schedule?.enabled })} className={cn("w-full h-12 rounded-full font-bold transition-all border-border/50", schedule?.enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border-transparent shadow-sm" : "hover:bg-secondary")}>
                            {schedule?.enabled ? <><PauseCircle className="h-4 w-4 mr-2" /> Pause Schedule</> : <><PlayCircle className="h-4 w-4 mr-2" /> Enable Schedule</>}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Interactive Grid Area */}
            <div className="rounded-[2.5rem] border border-border/50 bg-card/30 backdrop-blur-xl shadow-xl overflow-hidden p-6 sm:p-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 border-b border-border/50 pb-8">
                    <div className="flex gap-2 p-1.5 bg-secondary/50 rounded-2xl border border-border/50 w-max shadow-inner">
                        {(['V1', 'Legacy'] as const).map(v => (
                            <Button 
                                key={v} 
                                variant="ghost" 
                                className={cn("rounded-[0.85rem] px-8 h-12 text-sm font-bold transition-all", activeVersionTab === v ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:text-foreground")}
                                onClick={() => setActiveVersionTab(v)}
                            >
                                {v} API
                            </Button>
                        ))}
                    </div>

                    <div className="flex gap-2 p-1.5 bg-secondary/50 rounded-full border border-border/50 overflow-x-auto w-full md:w-auto scrollbar-none shadow-inner">
                        {categoriesForVersion.map(cat => (
                            <Button 
                                key={cat} 
                                variant="ghost" 
                                className={cn("rounded-full px-5 h-10 text-xs font-semibold whitespace-nowrap transition-all", activeCategoryTab === cat ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                                onClick={() => setActiveCategoryTab(cat)}
                            >
                                {cat}
                                <Badge variant="secondary" className="ml-2 bg-secondary/80 text-[10px] h-5 px-1.5 font-bold">{groupedStatuses[activeVersionTab]?.[cat]?.length || 0}</Badge>
                            </Button>
                        ))}
                    </div>
                </div>

                <ScrollArea className="h-[550px] pr-4">
                    {loading && statuses.length === 0 ? (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 w-full rounded-3xl" />)}
                        </div>
                    ) : displayedEndpoints.length === 0 ? (
                         <div className="flex flex-col items-center justify-center h-[400px] text-center gap-4">
                            <div className="h-24 w-24 bg-muted/30 rounded-[2rem] flex items-center justify-center">
                                <Database className="h-10 w-10 text-muted-foreground opacity-50" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">No endpoints found</h3>
                            <p className="text-muted-foreground">Try refreshing the status or selecting another category.</p>
                        </div>
                    ) : (
                        <StaggerContainer className="grid grid-cols-1 lg:grid-cols-2 gap-5 pb-4">
                            {displayedEndpoints.map((status) => {
                                const yearState = status.years.find((y) => y.year === year);
                                const progress = syncProgress[status.endpoint];
                                const isSyncingThis = syncing === status.endpoint;

                                return (
                                    <StaggerItem key={status.endpoint}>
                                        <div className={cn(
                                            "group relative flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-[2rem] border bg-background/50 hover:bg-card hover:shadow-xl transition-all duration-300 gap-5 overflow-hidden",
                                            isSyncingThis ? "border-primary/50 shadow-lg shadow-primary/10 ring-1 ring-primary/20 bg-primary/5" : "border-border/50 shadow-sm hover:border-primary/20"
                                        )}>
                                            {/* Glowing accent border top */}
                                            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/0 to-transparent group-hover:via-primary/50 transition-all duration-500" />
                                            
                                            <div className="flex-1 min-w-0 z-10">
                                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                                    <div className="h-8 w-8 bg-secondary/80 rounded-xl flex items-center justify-center border border-border/50 shadow-inner text-foreground/70">
                                                        <FileJson className="h-4 w-4" />
                                                    </div>
                                                    <span className="font-extrabold text-sm truncate text-foreground/90">
                                                        {status.label}
                                                    </span>
                                                </div>

                                                <div className="flex flex-col gap-2 mt-3 pl-[44px]">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {getStatusBadge(status.endpoint, status)}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-muted-foreground/80 mt-1">
                                                        {yearState && (
                                                            <span className="flex items-center gap-1.5 bg-secondary/50 px-2 py-1 rounded-md">
                                                                <Clock className="h-3 w-3" />
                                                                {formatDate(yearState.state.lastSyncDate)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {progress?.records > 0 && (
                                                        <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-primary/80 bg-primary/10 px-2 py-1 rounded-md inline-block w-max">
                                                            Processed {progress.records.toLocaleString()} records...
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="z-10 flex shrink-0 sm:self-center mt-2 sm:mt-0">
                                                <Button
                                                    variant={isSyncingThis ? "secondary" : "outline"}
                                                    size="icon"
                                                    onClick={() => syncEndpoint(status.endpoint)}
                                                    disabled={syncing !== null || batchSyncing}
                                                    className={cn(
                                                        "h-14 w-14 rounded-full border-border/50 bg-background hover:bg-primary hover:text-primary-foreground hover:border-transparent transition-all shadow-sm group-hover:shadow-md",
                                                        isSyncingThis && "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:text-primary"
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

                <div className="mt-6 pt-6 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-muted-foreground/70">
                    <div className="flex items-center gap-2.5 bg-background/50 px-4 py-2 rounded-xl border border-border/50 shadow-inner">
                        <FolderOpen className="h-4 w-4 text-primary/60" />
                        <span>Storage Root: <strong className="text-foreground/80 ml-1">{basePath || 'Pending...'}</strong></span>
                    </div>
                </div>
            </div>
        </FadeIn>
    );
}
