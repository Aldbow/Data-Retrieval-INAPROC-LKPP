'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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
import { Loader2, Search, Filter, Database, TrendingUp, DollarSign, Eye, Download, AlertTriangle, Activity, Box, Command } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DetailSheet } from "@/components/detail-sheet";
import { SyncManager } from "@/components/sync-manager";
import { RangeSyncManager } from "@/components/range-sync-manager";
import { ENDPOINTS } from "@/lib/constants";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from '@/components/layout/app-shell';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
    const [selectedEndpoint, setSelectedEndpoint] = useState(ENDPOINTS[0].value);
    const [activeTab, setActiveTab] = useState('browser');
    const [year, setYear] = useState('2026');
    const [search, setSearch] = useState('');
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const parentRef = useRef<HTMLDivElement>(null);
    const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected'>('connected');
    const [dataSource, setDataSource] = useState<'live' | 'local'>('local');
    const [apiError, setApiError] = useState<{message: string, local_not_found?: boolean} | null>(null);

    const requiresId = !!ENDPOINTS.find(ep => ep.value === selectedEndpoint)?.requiresId;

    const fetchPage = async ({ pageParam = null }: any) => {
        setApiError(null);
        const query = new URLSearchParams({
            year,
            limit: dataSource === 'local' ? '150' : '50',
            endpoint: selectedEndpoint,
        });
        if (search) query.set('search', search);
        if (pageParam) query.set('cursor', pageParam);

        const route = dataSource === 'local' ? '/api/local' : '/api/inaproc';
        const res = await fetch(`${route}?${query.toString()}`);
        const data = await res.json();

        if (!res.ok) {
            setApiStatus('disconnected');
            setApiError({ message: data.error || "API Response not ok", local_not_found: data.local_not_found });
            throw new Error(data.error || "API Response not ok");
        }
        setApiStatus('connected');
        return data;
    };

    const {
        data: queryData,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        refetch,
        isError,
        error
    } = useInfiniteQuery({
        queryKey: ['inaproc', selectedEndpoint, year, search, dataSource],
        queryFn: fetchPage,
        getNextPageParam: (lastPage) => {
            if (lastPage.has_more === false) return undefined;
            return lastPage.cursor || (lastPage.meta && lastPage.meta.cursor) || undefined;
        },
        enabled: !requiresId,
        initialPageParam: null as string | null
    });

    const flatData = queryData?.pages.flatMap(page => page.data || []) || [];

    const getDynamicColumns = () => {
        if (flatData.length === 0) return [];
        const keys = new Set<string>();
        flatData.slice(0, 5).forEach(item => Object.keys(item).forEach(k => keys.add(k)));
        return Array.from(keys);
    };
    const columns = getDynamicColumns();

    const rowVirtualizer = useVirtualizer({
        count: flatData.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 64,
        overscan: 5,
    });
    
    const virtualItems = rowVirtualizer.getVirtualItems();
    const paddingTop = virtualItems.length > 0 ? virtualItems[0]?.start || 0 : 0;
    const paddingBottom = virtualItems.length > 0
        ? rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end || 0)
        : 0;

    const handleExport = async () => {
        setIsExporting(true);
        const toastId = toast.loading("Generating Export on server...");

        try {
            const query = new URLSearchParams({
                year,
                endpoint: selectedEndpoint,
            });
            if (search) query.set('search', search);

            const res = await fetch(`/api/export?${query.toString()}`);
            if (!res.ok) throw new Error("Failed to generate export");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `INAPROC_Data_${year}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast.success(`Export complete!`, { id: toastId });
        } catch (error) {
            console.error("Export failed:", error);
            toast.error("Export failed. Please check console for details.", { id: toastId });
        } finally {
            setIsExporting(false);
        }
    };

    const stats = useMemo(() => {
        const priceKeys = ['total_harga', 'pagu', 'nilai_kontrak', 'nilai_pagu_paket', 'total_pagu'];
        const totalPagu = flatData.reduce((acc, item) => {
            for (const key of priceKeys) {
                if (item[key]) return acc + (parseFloat(item[key]) || 0);
            }
            return acc;
        }, 0);

        const activeCount = flatData.reduce((acc, item) => {
            const statusKey = Object.keys(item).find(k => k.toLowerCase().includes('status'));
            if (statusKey) {
                const statusVal = String(item[statusKey]).toLowerCase();
                if (statusVal.includes('aktif') || statusVal.includes('selesai') || statusVal.includes('tayang')) {
                    return acc + 1;
                }
            }
            return acc;
        }, 0);

        return { totalItems: flatData.length, totalPagu, activeCount };
    }, [flatData]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(val);
    };

    return (
        <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
            <DetailSheet open={isSheetOpen} onOpenChange={setIsSheetOpen} data={selectedItem} />

            <AnimatePresence mode="wait">
                {activeTab === 'browser' && (
                    <motion.div key="browser" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full flex flex-col">
                        
                        {/* Bento Grid Header */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1, duration: 0.5 }} className="md:col-span-2 relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-8 group hover:border-primary/30 transition-colors">
                                <div className="absolute -top-12 -right-12 p-8 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none transform group-hover:scale-110 group-hover:rotate-6 duration-700">
                                    <DollarSign className="w-64 h-64 text-primary" />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shadow-inner">
                                            <TrendingUp className="w-5 h-5" />
                                        </div>
                                        <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-sm">Total Value (Pagu)</h3>
                                    </div>
                                    <div className="mt-4 flex items-end gap-3">
                                        <h1 suppressHydrationWarning className="text-5xl sm:text-7xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 via-emerald-600 to-primary drop-shadow-sm">
                                            {formatCurrency(stats.totalPagu).replace('Rp', '').trim()}
                                        </h1>
                                        <span className="text-2xl text-muted-foreground mb-3 font-medium bg-background/50 px-3 py-1 rounded-lg backdrop-blur-md">IDR</span>
                                    </div>
                                    <p suppressHydrationWarning className="mt-6 text-muted-foreground font-medium text-sm">Aggregated value of {stats.totalItems.toLocaleString()} visible records from the year {year}.</p>
                                </div>
                            </motion.div>

                            <div className="grid grid-rows-2 gap-6">
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, duration: 0.5 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 flex flex-col justify-between group hover:border-primary/30 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">Total Records</h3>
                                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                            <Database className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <h2 suppressHydrationWarning className="text-5xl font-bold tracking-tight text-foreground/90">{stats.totalItems.toLocaleString()}</h2>
                                        <p className="text-sm text-muted-foreground mt-2 font-medium">Data entries currently loaded</p>
                                    </div>
                                </motion.div>

                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.5 }} className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 flex flex-col justify-between group hover:border-primary/30 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">System API Status</h3>
                                        <div className={cn("p-2 rounded-xl", apiStatus === 'connected' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500")}>
                                            <Activity className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <div className="flex items-center gap-4">
                                            <span className="relative flex h-5 w-5">
                                                <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", apiStatus === 'connected' ? "bg-emerald-400" : "bg-rose-400")}></span>
                                                <span className={cn("relative inline-flex rounded-full h-5 w-5", apiStatus === 'connected' ? "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" : "bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]")}></span>
                                            </span>
                                            <h2 className={cn("text-3xl font-bold tracking-tight", apiStatus === 'connected' ? "text-emerald-500" : "text-rose-500")}>
                                                {apiStatus === 'connected' ? 'Operational' : 'Offline'}
                                            </h2>
                                        </div>
                                    </div>
                                </motion.div>
                            </div>
                        </div>

                        {/* Floating Command Bar */}
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="sticky top-20 z-30 mb-8 flex flex-col xl:flex-row items-center justify-between gap-4 bg-background/80 backdrop-blur-3xl border border-border/60 p-2 sm:p-3 rounded-[2rem] shadow-xl shadow-black/5 ring-1 ring-black/5 dark:ring-white/5">
                            <div className="relative w-full xl:max-w-[450px] flex-shrink-0 group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                </div>
                                <Input
                                    placeholder="Search packages keyword or data..."
                                    className="w-full pl-11 bg-black/5 dark:bg-white/5 border border-transparent hover:border-black/10 dark:hover:border-white/10 focus-visible:border-primary/30 shadow-inner rounded-full text-sm h-12 transition-all focus-visible:ring-4 focus-visible:ring-primary/10 placeholder:text-muted-foreground/60"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && refetch()}
                                />
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded-md border border-black/10 dark:border-white/10 bg-background/50 px-2 font-mono text-[10px] font-medium text-muted-foreground shadow-sm">
                                        <Command className="w-3 h-3" /> <span className="text-[10px]">K</span>
                                    </kbd>
                                </div>
                            </div>

                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full xl:w-auto">
                                <div className="flex p-1 bg-secondary/50 rounded-full border border-black/10 dark:border-white/10 shadow-sm w-full sm:w-auto">
                                    <button
                                        onClick={() => { setDataSource('local'); setApiError(null); }}
                                        className={cn("flex-1 sm:flex-none px-4 py-2 text-xs font-bold rounded-full transition-all whitespace-nowrap", dataSource === 'local' ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}
                                    >
                                        Local Data
                                    </button>
                                    <button
                                        onClick={() => { setDataSource('live'); setApiError(null); }}
                                        className={cn("flex-1 sm:flex-none px-4 py-2 text-xs font-bold rounded-full transition-all whitespace-nowrap", dataSource === 'live' ? "bg-background text-emerald-500 shadow-sm" : "text-muted-foreground hover:text-foreground")}
                                    >
                                        Live API
                                    </button>
                                </div>

                                <Select value={year} onValueChange={setYear}>
                                    <SelectTrigger className="w-full sm:w-[100px] h-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 hover:bg-background shadow-sm text-sm font-semibold focus:ring-4 focus:ring-primary/10 transition-all">
                                        <SelectValue placeholder="Year" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl">
                                        {Array.from({ length: 2027 - 2018 + 1 }, (_, i) => 2027 - i).map((y) => (
                                            <SelectItem key={y} value={String(y)} className="rounded-xl cursor-pointer font-medium focus:bg-primary/10 focus:text-primary">{y}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={selectedEndpoint} onValueChange={setSelectedEndpoint}>
                                    <SelectTrigger className="w-full sm:w-[280px] h-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 hover:bg-background shadow-sm text-sm font-medium px-5 focus:ring-4 focus:ring-primary/10 transition-all truncate">
                                        <SelectValue placeholder="Select Endpoint" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl max-h-[400px]">
                                        <SelectGroup>
                                            <SelectLabel className="text-primary/70 font-bold text-[10px] uppercase tracking-widest px-3 py-2">V1 Endpoints</SelectLabel>
                                            {ENDPOINTS.filter(ep => ep.type === 'v1').map((ep) => (
                                                <SelectItem key={ep.value} value={ep.value} className="rounded-xl cursor-pointer py-2.5 text-sm">{ep.label}</SelectItem>
                                            ))}
                                        </SelectGroup>
                                        <SelectGroup>
                                            <SelectLabel className="text-amber-600/70 font-bold text-[10px] uppercase tracking-widest px-3 py-2 mt-2">Legacy Endpoints</SelectLabel>
                                            {ENDPOINTS.filter(ep => ep.type === 'legacy').map((ep) => (
                                                <SelectItem key={ep.value} value={ep.value} className="rounded-xl cursor-pointer py-2.5 text-sm">{ep.label}</SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>

                                <div className="w-px h-8 bg-border/60 hidden sm:block mx-1" />

                                <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button variant="outline" size="icon" onClick={() => { setSearch(''); refetch(); }} disabled={isLoading || isExporting} className="h-12 w-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 hover:bg-secondary hover:text-primary transition-all shadow-sm">
                                                    <Filter className="h-4 w-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-xl font-medium">Reset Filters</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>

                                    <Button onClick={handleExport} disabled={isLoading || isExporting} className="h-12 px-6 rounded-full gap-2 shadow-lg shadow-primary/25 bg-gradient-to-b from-primary/90 to-primary hover:from-primary hover:to-primary/90 border border-primary/20 flex-1 sm:flex-none text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
                                        {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        {isExporting ? 'Exporting...' : 'Export CSV'}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>

                        {/* Canvas Table */}
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                            {ENDPOINTS.find(ep => ep.value === selectedEndpoint)?.requiresId ? (
                                <div className="border-2 border-dashed border-amber-500/20 bg-amber-500/5 rounded-[2.5rem] p-16 flex flex-col items-center justify-center text-center gap-6">
                                    <div className="h-24 w-24 bg-amber-500/10 rounded-full flex items-center justify-center animate-pulse">
                                        <AlertTriangle className="h-12 w-12 text-amber-500" />
                                    </div>
                                    <div className="max-w-lg space-y-3">
                                        <h3 className="font-bold text-2xl text-foreground">Parameter Required</h3>
                                        <p className="text-muted-foreground text-lg">
                                            The selected endpoint requires a specific ID or parameter. Please use the Sync Manager to fetch specific data.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-[2.5rem] border border-border/50 bg-card/30 backdrop-blur-xl shadow-xl overflow-hidden flex flex-col h-[700px] relative">
                                    <div className="p-0 flex-1 overflow-hidden relative">
                                        <div ref={parentRef} className="absolute inset-0 overflow-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                                            <table className="w-full text-sm text-left border-collapse relative">
                                                <TableHeader className="sticky top-0 z-20 bg-background/80 backdrop-blur-2xl shadow-[0_1px_0_rgba(255,255,255,0.05)]">
                                                    <TableRow className="border-none hover:bg-transparent">
                                                        <TableHead className="w-[80px] text-center font-bold text-muted-foreground uppercase tracking-wider text-xs py-6">Row</TableHead>
                                                        {columns.map(key => (
                                                            <TableHead key={key} className="whitespace-nowrap font-bold text-foreground/80 py-6 px-6 min-w-[180px] uppercase tracking-wider text-xs">
                                                                {key.replace(/_/g, ' ')}
                                                            </TableHead>
                                                        ))}
                                                        <TableHead className="w-[80px]"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {isError && apiError?.local_not_found ? (
                                                        <TableRow className="border-none hover:bg-transparent">
                                                            <TableCell colSpan={columns.length + 2 || 6} className="h-[500px] text-center">
                                                                <div className="flex flex-col items-center justify-center gap-4 max-w-md mx-auto">
                                                                    <div className="h-24 w-24 bg-amber-500/10 rounded-[2rem] flex items-center justify-center mb-2 shadow-inner">
                                                                        <Database className="h-10 w-10 text-amber-500" />
                                                                    </div>
                                                                    <h3 className="text-2xl font-bold text-foreground">Data Lokal Belum Tersedia</h3>
                                                                    <p className="text-muted-foreground leading-relaxed">{apiError.message}</p>
                                                                    <Button onClick={() => setActiveTab('sync')} className="mt-4 rounded-full px-8 h-12 shadow-lg shadow-primary/20 font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
                                                                        Buka Sync Manager
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : isLoading ? (
                                                        Array.from({ length: 10 }).map((_, index) => (
                                                            <TableRow key={index} className="border-b border-border/20">
                                                                <TableCell className="py-5"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                                                                {columns.length > 0 ? columns.map(key => (
                                                                    <TableCell key={key} className="px-6 py-5"><Skeleton className="h-4 w-full max-w-[200px]" /></TableCell>
                                                                )) : (
                                                                    <TableCell colSpan={5} className="px-6 py-5"><Skeleton className="h-4 w-full" /></TableCell>
                                                                )}
                                                                <TableCell><Skeleton className="h-8 w-8 rounded-full ml-auto" /></TableCell>
                                                            </TableRow>
                                                        ))
                                                    ) : flatData.length === 0 ? (
                                                        <TableRow className="border-none hover:bg-transparent">
                                                            <TableCell colSpan={columns.length + 2 || 6} className="h-[500px] text-center">
                                                                <div className="flex flex-col items-center justify-center gap-4">
                                                                    <div className="h-20 w-20 bg-muted/50 rounded-3xl flex items-center justify-center mb-2">
                                                                        <Box className="h-10 w-10 text-muted-foreground opacity-50" />
                                                                    </div>
                                                                    <h3 className="text-xl font-bold text-foreground">No data found</h3>
                                                                    <p className="text-muted-foreground">Try adjusting your filters or search query.</p>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        <>
                                                            {paddingTop > 0 && <tr><td style={{ height: `${paddingTop}px` }} /></tr>}
                                                            {virtualItems.map((virtualRow) => {
                                                                const item = flatData[virtualRow.index];
                                                                return (
                                                                    <TableRow
                                                                        key={virtualRow.index}
                                                                        ref={rowVirtualizer.measureElement}
                                                                        data-index={virtualRow.index}
                                                                        className="group border-b border-border/20 hover:bg-primary/5 transition-all cursor-pointer"
                                                                        onClick={() => {
                                                                            setSelectedItem(item);
                                                                            setIsSheetOpen(true);
                                                                        }}
                                                                    >
                                                                        <TableCell className="text-center font-mono text-xs text-muted-foreground/50 group-hover:text-primary transition-colors py-5">
                                                                            {String(virtualRow.index + 1).padStart(3, '0')}
                                                                        </TableCell>
                                                                        {columns.map(key => {
                                                                            const val = item[key];
                                                                            return (
                                                                                <TableCell key={key} className="px-6 py-5 max-w-[350px] truncate text-muted-foreground group-hover:text-foreground transition-colors font-medium">
                                                                                    {(() => {
                                                                                        if (val === null || val === undefined) return <span className="text-muted-foreground/30 font-light">&mdash;</span>;
                                                                                        if (typeof val === 'number' && (key.includes('harga') || key.includes('pagu') || key.includes('nilai'))) {
                                                                                            return <span className="font-mono text-emerald-500 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-md">{formatCurrency(val)}</span>;
                                                                                        }
                                                                                        if (typeof val === 'string' && key.includes('status')) {
                                                                                            return <Badge variant="secondary" className="font-medium text-[11px] px-3 py-1 rounded-full bg-secondary/80 text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">{val}</Badge>;
                                                                                        }
                                                                                        if (typeof val === 'object') return <span className="italic text-xs opacity-50">JSON Object</span>;
                                                                                        return <span title={String(val)}>{String(val)}</span>;
                                                                                    })()}
                                                                                </TableCell>
                                                                            );
                                                                        })}
                                                                        <TableCell className="pr-6 text-right">
                                                                            <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                <div className="h-9 w-9 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-md shadow-primary/30 transform group-hover:scale-110 transition-transform">
                                                                                    <Eye className="h-4 w-4" />
                                                                                </div>
                                                                            </div>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                            {paddingBottom > 0 && <tr><td style={{ height: `${paddingBottom}px` }} /></tr>}
                                                        </>
                                                    )}
                                                </TableBody>
                                            </table>
                                        </div>
                                    </div>
                                    
                                    {(hasNextPage || isFetchingNextPage) && (
                                        <div className="p-4 border-t border-border/30 bg-background/60 backdrop-blur-xl flex justify-center sticky bottom-0 z-20">
                                            <Button
                                                variant="outline"
                                                onClick={(e) => { e.preventDefault(); fetchNextPage(); }}
                                                disabled={isFetchingNextPage || isLoading}
                                                className="w-full max-w-md gap-2 font-bold rounded-full h-12 bg-background/50 hover:bg-secondary border-border/50 shadow-sm"
                                            >
                                                {isFetchingNextPage ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <TrendingUp className="h-5 w-5 text-primary" />}
                                                {isFetchingNextPage ? 'Fetching more records...' : 'Load More Data'}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}

                {activeTab === 'sync' && (
                    <motion.div key="sync" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full">
                        <div className="flex flex-col gap-6 mb-8">
                            <div>
                                <h2 className="text-3xl font-extrabold tracking-tight">Data Sync Manager</h2>
                                <p className="text-muted-foreground mt-2 font-medium">Synchronize legacy endpoints to standard format</p>
                            </div>
                            <div className="w-full">
                                <SyncManager year={year} onSyncComplete={() => refetch()} onYearChange={setYear} />
                            </div>
                        </div>
                    </motion.div>
                )}

                {activeTab === 'range-sync' && (
                    <motion.div key="range-sync" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full">
                        <div className="flex flex-col gap-6 mb-8">
                            <div>
                                <h2 className="text-3xl font-extrabold tracking-tight">Range Sync Manager</h2>
                                <p className="text-muted-foreground mt-2 font-medium">Bulk synchronize data across multiple years and endpoints</p>
                            </div>
                            <RangeSyncManager />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </AppShell>
    );
}
