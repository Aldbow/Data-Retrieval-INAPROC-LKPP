'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
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

    // Fetch sync status
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
        // Initial load without heavy verification for speed
        fetchStatus(false);
    }, [fetchStatus]);

    // Reset sync progress when year changes
    useEffect(() => {
        setSyncProgress({});
    }, [year]);

    // Sync a single endpoint
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
                        batchSize: 100, // Max limit allowed by API
                        maxPages: 50, // Process 50 pages (5000 records) per batch write
                    }),
                });

                const result = await res.json();

                if (!result.success) {
                    throw new Error(result.error || 'Sync failed');
                }

                isComplete = result.isComplete;

                setSyncProgress((prev) => ({
                    ...prev,
                    [endpoint]: {
                        status: isComplete ? 'complete' : 'syncing',
                        records: result.totalRecords,
                    },
                }));

                // Small delay between batches
                if (!isComplete) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            }

            setSyncProgress((prev) => ({
                ...prev,
                [endpoint]: { status: 'complete', records: prev[endpoint]?.records || 0 },
            }));

            if (!batchSyncing) {
                await fetchStatus(true); // Verify after sync
                toast.success(`Sync for ${endpoint} completed!`);
            }
            onSyncComplete?.();
        } catch (error: any) {
            console.error('Sync error:', error);
            setSyncProgress((prev) => ({
                ...prev,
                [endpoint]: { status: 'error', records: 0 },
            }));
            toast.error(`Sync failed for ${endpoint}`);
        } finally {
            setSyncing(null);
        }
    };

    // Batch sync all endpoints (excluding detail endpoints that require IDs)
    const batchSync = async () => {
        setBatchSyncing(true);
        const syncableEndpoints = getSyncableEndpoints();
        toast.info("Starting batch sync...");

        for (const ep of syncableEndpoints) {
            if (!batchSyncing) break; // Allow cancellation logic if we add it
            await syncEndpoint(ep.value);
        }

        setBatchSyncing(false);
        await fetchStatus(true);
    };

    // Update schedule
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
            console.error('Failed to update schedule:', error);
            toast.error("Failed to update schedule");
        }
    };

    // Format date
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never synced';
        const date = new Date(dateStr);
        return date.toLocaleString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Get status badge for endpoint
    const getStatusBadge = (endpoint: string, status: EndpointStatus) => {
        const progress = syncProgress[endpoint];
        const yearState = status.years.find((y) => y.year === year);

        if (progress?.status === 'syncing') {
            return (
                <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-600 animate-pulse border-blue-200">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Syncing...
                </Badge>
            );
        }

        if (progress?.status === 'complete') {
            return (
                <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-200">
                    <CheckCircle className="h-3 w-3" />
                    Complete
                </Badge>
            );
        }

        if (progress?.status === 'error') {
            return (
                <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Error
                </Badge>
            );
        }

        if (yearState) {
            return (
                <Badge variant="outline" className="gap-1 border-muted-foreground/30 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {yearState.state.totalRecords.toLocaleString()} recs
                </Badge>
            );
        }

        return (
            <Badge variant="outline" className="text-muted-foreground/50 border-dashed">
                Ready to Sync
            </Badge>
        );
    };

    return (
        <FadeIn>
            <Card className="glass-card mb-6">
                <CardHeader className="border-b border-border/50 pb-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Server className="h-5 w-5 text-primary" />
                                Sync Manager
                            </CardTitle>
                            <CardDescription>
                                Manage local data synchronization from INAPROC servers.
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={year} onValueChange={onYearChange}>
                                <SelectTrigger className="w-[100px] h-9 bg-background/50 border-input shadow-sm">
                                    <SelectValue placeholder="Year" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 2026 - 2018 + 1 }, (_, i) => 2026 - i).map((y) => (
                                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fetchStatus(true)}
                                disabled={loading}
                                className="h-9"
                            >
                                <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                                Refresh Status
                            </Button>

                            <ScaleOnHover>
                                <Button
                                    size="sm"
                                    onClick={batchSync}
                                    disabled={batchSyncing || syncing !== null}
                                    className="bg-primary hover:bg-primary/90 h-9 transition-all shadow-lg shadow-primary/20"
                                >
                                    {batchSyncing ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Batch Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <Zap className="h-4 w-4 mr-2" />
                                            Sync All Now
                                        </>
                                    )}
                                </Button>
                            </ScaleOnHover>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6">
                    {/* Schedule Banner */}
                    <div className="bg-gradient-to-r from-primary/5 via-primary/10 to-transparent p-4 rounded-xl border border-primary/10 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-primary/20 rounded-full flex items-center justify-center">
                                <Clock className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm">Automated Schedule</h4>
                                <p className="text-xs text-muted-foreground">
                                    {schedule?.lastRun
                                        ? `Last run: ${formatDate(schedule.lastRun)}`
                                        : 'Configure auto-sync frequency'}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Select
                                value={schedule?.type || 'daily'}
                                onValueChange={(value) =>
                                    updateSchedule({ type: value as 'daily' | 'weekly' })
                                }
                            >
                                <SelectTrigger className="w-[120px] h-8 text-xs bg-background/50 border-input">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="daily">Daily</SelectItem>
                                    <SelectItem value="weekly">Weekly</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                variant={schedule?.enabled ? 'default' : 'secondary'}
                                size="sm"
                                onClick={() => updateSchedule({ enabled: !schedule?.enabled })}
                                className={cn("h-8 gap-2 transition-all", schedule?.enabled ? "bg-green-600 hover:bg-green-700 text-white" : "text-muted-foreground")}
                            >
                                {schedule?.enabled ? (
                                    <>
                                        <PauseCircle className="h-3.5 w-3.5" />
                                        Active
                                    </>
                                ) : (
                                    <>
                                        <PlayCircle className="h-3.5 w-3.5" />
                                        Enable
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Endpoints Grid */}
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        Available Endpoints
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{ENDPOINTS.length}</Badge>
                    </h3>

                    <ScrollArea className="h-[450px] pr-4">
                        <div className="grid grid-cols-1 gap-2">

                            {loading && statuses.length === 0 ? (
                                <StaggerContainer key="skeleton">
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <StaggerItem key={i}>
                                            <div className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card/40 gap-3">
                                                <div className="space-y-2 flex-1">
                                                    <Skeleton className="h-5 w-32" />
                                                    <Skeleton className="h-3 w-48" />
                                                </div>
                                                <Skeleton className="h-8 w-24" />
                                            </div>
                                        </StaggerItem>
                                    ))}
                                </StaggerContainer>
                            ) : statuses.length === 0 ? (
                                <div key="empty" className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                                    No sync status available. Try refreshing.
                                </div>
                            ) : (
                                (() => {
                                    // Group statuses by Version -> Category
                                    const groupedStatuses = statuses.reduce((acc, status) => {
                                        const version = status.endpoint.startsWith('/legacy') ? 'Legacy' : 'V1';
                                        let category = 'Lainnya';
                                        if (status.endpoint.includes('ekatalog')) category = 'E-Katalog';
                                        else if (status.endpoint.includes('rup')) category = 'RUP';
                                        else if (status.endpoint.includes('tender')) category = 'Tender';

                                        if (!acc[version]) acc[version] = {};
                                        if (!acc[version][category]) acc[version][category] = [];
                                        acc[version][category].push(status);
                                        return acc;
                                    }, {} as Record<string, Record<string, EndpointStatus[]>>);

                                    return (
                                        <Accordion type="multiple" defaultValue={['V1', 'Legacy']} className="w-full space-y-4">
                                            {['V1', 'Legacy'].map(version => {
                                                const categories = groupedStatuses[version];
                                                if (!categories) return null;

                                                return (
                                                    <AccordionItem key={version} value={version} className="border-border/60 bg-card/40 rounded-xl px-4 border">
                                                        <AccordionTrigger className="hover:no-underline font-semibold text-lg py-4">
                                                            <div className="flex items-center gap-2">
                                                                {version} Endpoints
                                                                <Badge variant="outline" className="text-[10px] h-5 bg-background">
                                                                    {Object.values(categories).flat().length}
                                                                </Badge>
                                                            </div>
                                                        </AccordionTrigger>
                                                        <AccordionContent>
                                                            <Accordion type="multiple" defaultValue={['E-Katalog', 'RUP', 'Tender', 'Lainnya'].map(c => `${version}-${c}`)} className="w-full space-y-3 mt-2">
                                                                {['E-Katalog', 'RUP', 'Tender', 'Lainnya'].map(category => {
                                                                    const items = categories[category];
                                                                    if (!items || items.length === 0) return null;

                                                                    return (
                                                                        <AccordionItem key={`${version}-${category}`} value={`${version}-${category}`} className="border-border/60 bg-background/50 rounded-lg px-4 border">
                                                                            <AccordionTrigger className="hover:no-underline font-medium text-md py-3">
                                                                                <div className="flex items-center gap-2">
                                                                                    {category}
                                                                                    <Badge variant="secondary" className="text-[10px] h-5">{items.length}</Badge>
                                                                                </div>
                                                                            </AccordionTrigger>
                                                                            <AccordionContent className="pt-2 pb-4">
                                                                                <div className="grid grid-cols-1 gap-2">
                                                                                    {items.map((status) => {
                                                                                        const yearState = status.years.find((y) => y.year === year);
                                                                                        const progress = syncProgress[status.endpoint];
                                                                                        const isSyncingThis = syncing === status.endpoint;

                                                                                        return (
                                                                                            <div key={status.endpoint} className={cn(
                                                                                                "group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border bg-card/40 hover:bg-card/80 transition-all duration-300 gap-3",
                                                                                                isSyncingThis ? "border-primary/50 shadow-md shadow-primary/5 ring-1 ring-primary/20" : "border-border/60"
                                                                                            )}>
                                                                                                <div className="flex-1 min-w-0">
                                                                                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                                                        <span className="font-semibold text-sm truncate text-foreground/90">
                                                                                                            {status.label}
                                                                                                        </span>
                                                                                                        {getStatusBadge(status.endpoint, status)}
                                                                                                    </div>

                                                                                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                                                                        <span className="flex items-center gap-1.5">
                                                                                                            <FolderOpen className="h-3 w-3 opacity-70" />
                                                                                                            {yearState ? yearState.state.filePath : 'No file'}
                                                                                                        </span>
                                                                                                        {yearState && (
                                                                                                            <span className="flex items-center gap-1.5 border-l border-border pl-4">
                                                                                                                <Clock className="h-3 w-3 opacity-70" />
                                                                                                                {formatDate(yearState.state.lastSyncDate)}
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>

                                                                                                    {progress?.records > 0 && (
                                                                                                        <div className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded inline-block">
                                                                                                            Processed {progress.records.toLocaleString()} records so far...
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>

                                                                                                <ScaleOnHover>
                                                                                                    <Button
                                                                                                        variant={isSyncingThis ? "secondary" : "ghost"}
                                                                                                        size="sm"
                                                                                                        onClick={() => syncEndpoint(status.endpoint)}
                                                                                                        disabled={syncing !== null || batchSyncing}
                                                                                                        className={cn(
                                                                                                            "w-full sm:w-auto shrink-0 gap-2 font-medium border border-transparent",
                                                                                                            !isSyncingThis && "group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/10"
                                                                                                        )}
                                                                                                    >
                                                                                                        {isSyncingThis ? (
                                                                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                                                                        ) : (
                                                                                                            <Download className="h-4 w-4" />
                                                                                                        )}
                                                                                                        {isSyncingThis ? 'Syncing...' : 'Sync Now'}
                                                                                                    </Button>
                                                                                                </ScaleOnHover>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </AccordionContent>
                                                                        </AccordionItem>
                                                                    );
                                                                })}
                                                            </Accordion>
                                                        </AccordionContent>
                                                    </AccordionItem>
                                                );
                                            })}
                                        </Accordion>
                                    );
                                })()
                            )}
                        </div>
                    </ScrollArea>

                    <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <FolderOpen className="h-3 w-3" />
                            <span>Storage Path: <code className="bg-secondary/50 px-1 py-0.5 rounded text-foreground">{basePath}</code></span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </FadeIn>
    );
}
