'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, Filter, Database, TrendingUp, DollarSign, Eye, Download, AlertTriangle, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DetailSheet } from "@/components/detail-sheet";
import { SyncManager } from "@/components/sync-manager";
import { RangeSyncManager } from "@/components/range-sync-manager";
import { ENDPOINTS } from "@/lib/constants";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppShell } from '@/components/layout/app-shell';
import { FadeIn, SlideUp, StaggerContainer, StaggerItem, AnimatePresence } from '@/components/ui/motion-primitives';
import { cn } from "@/lib/utils";

export default function Home() {
    // Dynamic Endpoint
    const [selectedEndpoint, setSelectedEndpoint] = useState(ENDPOINTS[0].value);

    // Tab state: 'browser' | 'sync' | 'range-sync'
    // Lifted out for AppShell usage
    const [activeTab, setActiveTab] = useState('browser');

    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [year, setYear] = useState('2025');
    const [search, setSearch] = useState('');
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    // API Connection Status
    const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected'>('connected');

    // Client-side pagination state for Legacy endpoints
    const [allLegacyData, setAllLegacyData] = useState<any[]>([]);
    const [legacyPage, setLegacyPage] = useState(0);
    const ROWS_PER_PAGE = 50;

    // Sheet state
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    // Dynamic Columns Helper
    const getDynamicColumns = () => {
        if (data.length === 0) return [];
        const keys = new Set<string>();
        // Sample first 5 items to get keys
        data.slice(0, 5).forEach(item => {
            Object.keys(item).forEach(k => keys.add(k));
        });
        return Array.from(keys);
    };

    const columns = getDynamicColumns();

    // Export state
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        const toastId = toast.loading("Starting export...");

        try {
            const XLSX = await import("xlsx");
            let allExportData: any[] = [];
            let currentCursor: string | null = null;
            let keepFetching = true;
            let pageCount = 0;

            // Initial fetch params
            const baseQuery = new URLSearchParams({
                year,
                limit: '100', // Fetch in larger chunks for export
                endpoint: selectedEndpoint,
            });
            if (search) {
                baseQuery.set('search', search);
            }

            while (keepFetching) {
                const query = new URLSearchParams(baseQuery);
                if (currentCursor) {
                    query.set('cursor', currentCursor);
                }

                const res = await fetch(`/api/inaproc?${query.toString()}`);
                if (!res.ok) throw new Error("Failed to fetch data for export");

                const result = await res.json();
                const pageData = result.data || [];

                if (pageData.length === 0) {
                    keepFetching = false;
                } else {
                    allExportData = [...allExportData, ...pageData];

                    // Check cursor
                    const nextCursor = result.cursor || (result.meta && result.meta.cursor);
                    if (nextCursor && result.has_more !== false) {
                        currentCursor = nextCursor;
                    } else {
                        keepFetching = false;
                    }
                }

                // Safety break to prevent infinite loops during dev (remove or increase limit for prod)
                if (pageCount > 100) break;
                pageCount++;

                toast.loading(`Exporting... (${allExportData.length} rows)`, { id: toastId });

                // Small delay to be nice to API
                await new Promise(r => setTimeout(r, 200));
            }

            // Create Excel
            const worksheet = XLSX.utils.json_to_sheet(allExportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, `Data ${year}`);

            // Generate filename
            const filename = `INAPROC_Data_${year}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            XLSX.writeFile(workbook, filename);

            toast.success(`Export complete! Saved as ${filename}`, { id: toastId });

        } catch (error) {
            console.error("Export failed:", error);
            toast.error("Export failed. Please check console for details.", { id: toastId });
        } finally {
            setIsExporting(false);
        }
    };

    // Stats
    const [stats, setStats] = useState({ totalItems: 0, totalPagu: 0, activeCount: 0 });

    const fetchData = async (reset = false, nextCursor: string | null = null) => {
        // Check if endpoint is restricted
        const currentEp = ENDPOINTS.find(ep => ep.value === selectedEndpoint);
        if (currentEp?.requiresId) {
            setLoading(false);
            setData([]); // Clear data
            return;
        }

        // Client-side pagination logic for Legacy
        if (!reset && nextCursor === 'CLIENT_SIDE' && allLegacyData.length > 0) {
            const nextPage = legacyPage + 1;
            const start = nextPage * ROWS_PER_PAGE;
            const end = start + ROWS_PER_PAGE;
            const nextChunk = allLegacyData.slice(start, end);

            setData(prev => [...prev, ...nextChunk]);
            setLegacyPage(nextPage);
            setHasMore(end < allLegacyData.length);
            return;
        }

        setLoading(true);
        try {
            const query = new URLSearchParams({
                year,
                limit: '50',
                endpoint: selectedEndpoint,
            });
            if (nextCursor && nextCursor !== 'CLIENT_SIDE') {
                query.set('cursor', nextCursor);
            }
            if (search) {
                query.set('search', search);
            }

            const res = await fetch(`/api/inaproc?${query.toString()}`);
            if (!res.ok) throw new Error("API Response not ok"); // Simplify error for status check
            const result = await res.json();

            // If we got here, API is responsive
            setApiStatus('connected');

            if (result.data) {
                if (reset) {
                    // Check if it's a large legacy response (array without server pagination)
                    const isLegacyLarge = result.meta?.total > ROWS_PER_PAGE && result.has_more === false;

                    if (isLegacyLarge) {
                        // Store massive dataset in memory and paginate locally
                        setAllLegacyData(result.data);
                        setData(result.data.slice(0, ROWS_PER_PAGE));
                        setLegacyPage(0);
                        setHasMore(true);
                        setCursor('CLIENT_SIDE');
                    } else {
                        // Standard V1 or small legacy
                        setAllLegacyData([]);
                        setData(result.data);
                        const newCursor = result.cursor || (result.meta && result.meta.cursor);
                        setCursor(newCursor);
                        setHasMore(!!newCursor);
                    }
                    toast.success(`Loaded ${result.data.length} records`);
                } else {
                    setData(prev => [...prev, ...result.data]);
                    const newCursor = result.cursor || (result.meta && result.meta.cursor);
                    setCursor(newCursor);
                    setHasMore(!!newCursor);
                }
            } else {
                if (reset) setData([]);
            }
        } catch (error) {
            console.error("Failed to fetch data", error);
            toast.error("Failed to fetch data from API");
            setApiStatus('disconnected');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setCursor(null);
        setHasMore(false);
        setData([]);
        if (!ENDPOINTS.find(ep => ep.value === selectedEndpoint)?.requiresId) {
            fetchData(true);
        }
    }, [year, selectedEndpoint]);

    // Calculate stats logic remains same
    useEffect(() => {
        const sourceData = allLegacyData.length > 0 ? allLegacyData : data;

        const priceKeys = ['total_harga', 'pagu', 'nilai_kontrak', 'nilai_pagu_paket', 'total_pagu'];

        const totalPagu = sourceData.reduce((acc, item) => {
            for (const key of priceKeys) {
                if (item[key]) {
                    return acc + (parseFloat(item[key]) || 0);
                }
            }
            return acc;
        }, 0);

        const activeCount = sourceData.reduce((acc, item) => {
            // Check heuristic for active status
            const statusKey = Object.keys(item).find(k => k.toLowerCase().includes('status'));
            if (statusKey) {
                const statusVal = String(item[statusKey]).toLowerCase();
                if (statusVal.includes('aktif') || statusVal.includes('selesai') || statusVal.includes('tayang')) {
                    // Considering 'tayang' or 'aktif' as active for visualization
                    return acc + 1;
                }
            }
            return acc;
        }, 0);

        const totalCount = sourceData.length;
        setStats({ totalItems: totalCount, totalPagu, activeCount });
    }, [data, allLegacyData]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchData(true);
    };

    const loadMore = () => {
        if (cursor) {
            fetchData(false, cursor);
        }
    };

    const openDetails = (item: any) => {
        setSelectedItem(item);
        setIsSheetOpen(true);
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(val);
    };

    return (
        <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
            {/* Detail Sheet Component */}
            <DetailSheet
                open={isSheetOpen}
                onOpenChange={setIsSheetOpen}
                data={selectedItem}
            />

            <AnimatePresence mode="wait">
                {activeTab === 'range-sync' && (
                    <FadeIn key="range-sync" className="w-full">
                        <div className="flex flex-col gap-6">
                            <h2 className="text-2xl font-bold tracking-tight">Range Sync Manager</h2>
                            <RangeSyncManager />
                        </div>
                    </FadeIn>
                )}

                {activeTab === 'sync' && (
                    <FadeIn key="sync" className="w-full">
                        <div className="flex flex-col gap-6">
                            <h2 className="text-2xl font-bold tracking-tight">Data Sync Manager</h2>
                            <div className="w-full">
                                <SyncManager
                                    year={year}
                                    onSyncComplete={() => fetchData(true)}
                                    onYearChange={setYear}
                                />
                            </div>
                        </div>
                    </FadeIn>
                )}

                {activeTab === 'browser' && (
                    <FadeIn key="browser" className="w-full space-y-8">
                        {/* Stats Row */}
                        <div className="flex flex-col space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-2xl font-bold tracking-tight">Data Browser {year}</h2>
                                {/* Year Selector */}
                                <div className="flex items-center gap-2 bg-secondary/30 p-1.5 rounded-lg border border-border/50">
                                    <span className="text-xs font-medium text-muted-foreground px-2">Year:</span>
                                    <Select value={year} onValueChange={setYear}>
                                        <SelectTrigger className="w-[100px] h-8 bg-background border-none shadow-sm">
                                            <SelectValue placeholder="Year" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 2026 - 2018 + 1 }, (_, i) => 2026 - i).map((y) => (
                                                <SelectItem key={y} value={String(y)} className="cursor-pointer">
                                                    {y}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <StaggerContainer className="grid gap-4 md:gap-6 md:grid-cols-2 lg:grid-cols-3">
                                <StaggerItem>
                                    <div className="glass-card rounded-xl p-6">
                                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                                            <div className="text-sm font-medium text-muted-foreground">Total Records</div>
                                            <Database className="h-4 w-4 text-primary opacity-50" />
                                        </div>
                                        <div className="mt-4">
                                            <div className="text-3xl font-bold tracking-tight">{stats.totalItems.toLocaleString()}</div>
                                            <p className="text-xs text-muted-foreground mt-1">Rows loaded in current view</p>
                                        </div>
                                    </div>
                                </StaggerItem>
                                <StaggerItem>
                                    <div className="glass-card rounded-xl p-6">
                                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                                            <div className="text-sm font-medium text-muted-foreground">Total Value (Pagu)</div>
                                            <DollarSign className="h-4 w-4 text-emerald-500 opacity-80" />
                                        </div>
                                        <div className="mt-4">
                                            <div className="text-3xl font-bold tracking-tight truncate text-emerald-600 dark:text-emerald-400">
                                                {formatCurrency(stats.totalPagu).replace('Rp', '')}
                                                <span className="text-sm font-normal text-muted-foreground ml-1">IDR</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">Sum of visible contracts</p>
                                        </div>
                                    </div>
                                </StaggerItem>
                                <StaggerItem>
                                    <div className="glass-card rounded-xl p-6 border-l-4 border-l-blue-500/50">
                                        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                                            <div className="text-sm font-medium text-muted-foreground">Status Koneksi API</div>
                                            <Activity className={cn("h-4 w-4 opacity-80", apiStatus === 'connected' ? "text-emerald-500" : "text-rose-500")} />
                                        </div>
                                        <div className="mt-4">
                                            <div className={cn("text-3xl font-bold tracking-tight", apiStatus === 'connected' ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                                                {apiStatus === 'connected' ? 'Active' : 'Disconnected'}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {apiStatus === 'connected' ? 'Systems operational' : 'Connection lost'}
                                            </p>
                                        </div>
                                    </div>
                                </StaggerItem>
                            </StaggerContainer>
                        </div>


                        {/* Controls Bar */}
                        <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between bg-card/40 border border-border/50 p-4 rounded-xl shadow-sm sticky top-0 z-30 backdrop-blur-md">
                            <form onSubmit={handleSearch} className="relative w-full xl:w-96 shrink-0 group">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search packages keyword..."
                                    className="pl-9 bg-background/50 border-input focus:bg-background transition-all"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </form>
                            <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto items-stretch sm:items-center">
                                {/* Endpoint Selector */}
                                <Select value={selectedEndpoint} onValueChange={setSelectedEndpoint}>
                                    <SelectTrigger className="w-full sm:w-[300px] h-10 bg-background font-medium">
                                        <SelectValue placeholder="Select Endpoint" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[400px]">
                                        <SelectGroup>
                                            <SelectLabel className="text-primary font-semibold flex items-center gap-2 px-2 py-1.5 opacity-70 text-xs uppercase tracking-wider">
                                                V1 Endpoints
                                            </SelectLabel>
                                            {ENDPOINTS.filter(ep => ep.type === 'v1').map((ep) => (
                                                <SelectItem key={ep.value} value={ep.value}>
                                                    {ep.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                        <SelectGroup>
                                            <SelectLabel className="text-amber-600 font-semibold flex items-center gap-2 px-2 py-1.5 opacity-70 text-xs uppercase tracking-wider mt-2">
                                                Legacy Endpoints
                                            </SelectLabel>
                                            {ENDPOINTS.filter(ep => ep.type === 'legacy').map((ep) => (
                                                <SelectItem key={ep.value} value={ep.value}>
                                                    {ep.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>

                                {ENDPOINTS.find(ep => ep.value === selectedEndpoint)?.requiresId && (
                                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 gap-1 h-10 px-3 justify-center">
                                        <AlertTriangle className="h-3 w-3" />
                                        Requires ID
                                    </Badge>
                                )}

                                <div className="hidden sm:block w-px h-8 bg-border mx-2" />

                                <div className="flex gap-2 flex-1 sm:flex-none">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="outline" size="icon" onClick={() => fetchData(true)} disabled={loading || isExporting}>
                                                <Filter className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Reset Filters</TooltipContent>
                                    </Tooltip>

                                    <Button
                                        className="gap-2 flex-1 sm:flex-none font-medium shadow-md shadow-primary/10"
                                        onClick={handleExport}
                                        disabled={loading || isExporting}
                                    >
                                        {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        {isExporting ? `Exporting...` : 'Export'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Enhanced Data Table */}
                        <FadeIn>
                            {ENDPOINTS.find(ep => ep.value === selectedEndpoint)?.requiresId ? (
                                <div className="border border-dashed border-amber-200 bg-amber-50/50 rounded-xl p-12 flex flex-col items-center justify-center text-center gap-4">
                                    <div className="h-16 w-16 bg-amber-100/50 rounded-full flex items-center justify-center animate-pulse">
                                        <AlertTriangle className="h-8 w-8 text-amber-600" />
                                    </div>
                                    <div className="max-w-md space-y-2">
                                        <h3 className="font-semibold text-xl text-amber-900">Parameter Required</h3>
                                        <p className="text-amber-700/80">
                                            The selected endpoint requires a specific ID or parameter to function.
                                            Please use the Sync Manager to fetch specific data for this endpoint.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="glass-card overflow-hidden flex flex-col h-[650px] relative transition-all rounded-xl">
                                    <div className="p-0 flex-1 overflow-hidden relative bg-transparent">
                                        <div className="absolute inset-0 overflow-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                                            <table className="w-full text-sm text-left">
                                                <TableHeader className="sticky top-0 z-20 bg-secondary/90 backdrop-blur-md shadow-sm">
                                                    <TableRow className="border-b border-border/60 hover:bg-transparent">
                                                        <TableHead className="w-[60px] text-center font-bold text-muted-foreground pl-4">#</TableHead>
                                                        {columns.map(key => (
                                                            <TableHead key={key} className="whitespace-nowrap font-semibold text-foreground/80 py-4 px-4 min-w-[150px]">
                                                                {key.replace(/_/g, ' ')}
                                                            </TableHead>
                                                        ))}
                                                        <TableHead className="w-[60px]"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {data.length === 0 && !loading ? (
                                                        <TableRow>
                                                            <TableCell colSpan={columns.length + 2} className="h-64 text-center text-muted-foreground">
                                                                <div className="flex flex-col items-center gap-3">
                                                                    <Database className="h-10 w-10 opacity-20" />
                                                                    <p>No data found for this selection.</p>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        data.map((item, index) => (
                                                            <TableRow
                                                                key={index}
                                                                className="group border-b border-border/40 hover:bg-primary/5 transition-colors cursor-pointer"
                                                                onClick={() => openDetails(item)}
                                                            >
                                                                <TableCell className="text-center font-mono text-xs text-muted-foreground pl-4 group-hover:text-primary transition-colors">
                                                                    {index + 1}
                                                                </TableCell>
                                                                {columns.map(key => {
                                                                    const val = item[key];
                                                                    return (
                                                                        <TableCell key={key} className="px-4 py-3 max-w-[350px] truncate text-muted-foreground group-hover:text-foreground transition-colors">
                                                                            {(() => {
                                                                                if (val === null || val === undefined) return <span className="text-muted-foreground/30">-</span>;
                                                                                if (typeof val === 'number' && (key.includes('harga') || key.includes('pagu') || key.includes('nilai'))) {
                                                                                    return <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">{formatCurrency(val)}</span>;
                                                                                }
                                                                                if (typeof val === 'string' && key.includes('status')) {
                                                                                    return <Badge variant="secondary" className="font-normal text-[10px] px-2 h-5 bg-zinc-100 text-zinc-600 group-hover:bg-white">{val}</Badge>;
                                                                                }
                                                                                if (typeof val === 'object') return <span className="italic text-xs opacity-50">Object</span>;
                                                                                return <span title={String(val)}>{String(val)}</span>;
                                                                            })()}
                                                                        </TableCell>
                                                                    );
                                                                })}
                                                                <TableCell className="pr-4 text-right">
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 hover:text-primary">
                                                                        <Eye className="h-4 w-4" />
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))
                                                    )}
                                                </TableBody>
                                            </table>
                                        </div>
                                    </div>
                                    {
                                        (hasMore || loading) && (
                                            <div className="p-4 border-t border-border/50 bg-background/50 backdrop-blur-sm flex justify-center sticky bottom-0 z-20">
                                                <Button
                                                    variant="secondary"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        loadMore();
                                                    }}
                                                    disabled={loading}
                                                    className="w-full max-w-sm gap-2 font-medium"
                                                >
                                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                                    {loading ? 'Fetching more records...' : 'Load More Data'}
                                                </Button>
                                            </div>
                                        )
                                    }
                                </div>
                            )}
                        </FadeIn>
                    </FadeIn>
                )}
            </AnimatePresence>
        </AppShell>
    );
}
