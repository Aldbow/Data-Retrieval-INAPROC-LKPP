'use client';

import { useState, useEffect, useRef } from 'react';
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

export default function Home() {
    const [selectedEndpoint, setSelectedEndpoint] = useState(ENDPOINTS[0].value);
    const [activeTab, setActiveTab] = useState('browser');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [year, setYear] = useState('2025');
    const [search, setSearch] = useState('');
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected'>('connected');
    const [allLegacyData, setAllLegacyData] = useState<any[]>([]);
    const [legacyPage, setLegacyPage] = useState(0);
    const ROWS_PER_PAGE = 50;
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [stats, setStats] = useState({ totalItems: 0, totalPagu: 0, activeCount: 0 });

    const getDynamicColumns = () => {
        if (data.length === 0) return [];
        const keys = new Set<string>();
        data.slice(0, 5).forEach(item => Object.keys(item).forEach(k => keys.add(k)));
        return Array.from(keys);
    };
    const columns = getDynamicColumns();

    const handleExport = async () => {
        setIsExporting(true);
        const toastId = toast.loading("Starting export...");

        try {
            const XLSX = await import("xlsx");
            let allExportData: any[] = [];
            let currentCursor: string | null = null;
            let keepFetching = true;
            let pageCount = 0;

            const baseQuery = new URLSearchParams({
                year,
                limit: '100',
                endpoint: selectedEndpoint,
            });
            if (search) baseQuery.set('search', search);

            while (keepFetching) {
                const query = new URLSearchParams(baseQuery);
                if (currentCursor) query.set('cursor', currentCursor);

                const res = await fetch(`/api/inaproc?${query.toString()}`);
                if (!res.ok) throw new Error("Failed to fetch data for export");

                const result = await res.json();
                const pageData = result.data || [];

                if (pageData.length === 0) {
                    keepFetching = false;
                } else {
                    allExportData = [...allExportData, ...pageData];
                    const nextCursor = result.cursor || (result.meta && result.meta.cursor);
                    if (nextCursor && result.has_more !== false) {
                        currentCursor = nextCursor;
                    } else {
                        keepFetching = false;
                    }
                }

                if (pageCount > 100) break;
                pageCount++;
                toast.loading(`Exporting... (${allExportData.length} rows)`, { id: toastId });
                await new Promise(r => setTimeout(r, 200));
            }

            const worksheet = XLSX.utils.json_to_sheet(allExportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, `Data ${year}`);
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

    const fetchData = async (reset = false, nextCursor: string | null = null) => {
        const currentEp = ENDPOINTS.find(ep => ep.value === selectedEndpoint);
        if (currentEp?.requiresId) {
            setLoading(false);
            setData([]);
            return;
        }

        if (!reset && nextCursor === 'CLIENT_SIDE' && allLegacyData.length > 0) {
            const nextPage = legacyPage + 1;
            const start = nextPage * ROWS_PER_PAGE;
            const end = start + ROWS_PER_PAGE;
            setData(prev => [...prev, ...allLegacyData.slice(start, end)]);
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
            if (nextCursor && nextCursor !== 'CLIENT_SIDE') query.set('cursor', nextCursor);
            if (search) query.set('search', search);

            const res = await fetch(`/api/inaproc?${query.toString()}`);
            if (!res.ok) throw new Error("API Response not ok");
            const result = await res.json();
            setApiStatus('connected');

            if (result.data) {
                if (reset) {
                    const isLegacyLarge = result.meta?.total > ROWS_PER_PAGE && result.has_more === false;
                    if (isLegacyLarge) {
                        setAllLegacyData(result.data);
                        setData(result.data.slice(0, ROWS_PER_PAGE));
                        setLegacyPage(0);
                        setHasMore(true);
                        setCursor('CLIENT_SIDE');
                    } else {
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

    const filteredData = search 
        ? data.filter(item => Object.values(item).some(val => String(val).toLowerCase().includes(search.toLowerCase())))
        : data;

    useEffect(() => {
        const sourceData = allLegacyData.length > 0 ? allLegacyData : data;
        const priceKeys = ['total_harga', 'pagu', 'nilai_kontrak', 'nilai_pagu_paket', 'total_pagu'];

        const totalPagu = sourceData.reduce((acc, item) => {
            for (const key of priceKeys) {
                if (item[key]) return acc + (parseFloat(item[key]) || 0);
            }
            return acc;
        }, 0);

        const activeCount = sourceData.reduce((acc, item) => {
            const statusKey = Object.keys(item).find(k => k.toLowerCase().includes('status'));
            if (statusKey) {
                const statusVal = String(item[statusKey]).toLowerCase();
                if (statusVal.includes('aktif') || statusVal.includes('selesai') || statusVal.includes('tayang')) {
                    return acc + 1;
                }
            }
            return acc;
        }, 0);

        setStats({ totalItems: sourceData.length, totalPagu, activeCount });
    }, [data, allLegacyData]);

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
                                        <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 via-emerald-600 to-primary drop-shadow-sm">
                                            {formatCurrency(stats.totalPagu).replace('Rp', '').trim()}
                                        </h1>
                                        <span className="text-2xl text-muted-foreground mb-3 font-medium bg-background/50 px-3 py-1 rounded-lg backdrop-blur-md">IDR</span>
                                    </div>
                                    <p className="mt-6 text-muted-foreground font-medium text-sm">Aggregated value of {stats.totalItems.toLocaleString()} visible records from the year {year}.</p>
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
                                        <h2 className="text-5xl font-bold tracking-tight text-foreground/90">{stats.totalItems.toLocaleString()}</h2>
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
                                />
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded-md border border-black/10 dark:border-white/10 bg-background/50 px-2 font-mono text-[10px] font-medium text-muted-foreground shadow-sm">
                                        <Command className="w-3 h-3" /> <span className="text-[10px]">K</span>
                                    </kbd>
                                </div>
                            </div>

                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full xl:w-auto">
                                <Select value={year} onValueChange={setYear}>
                                    <SelectTrigger className="w-full sm:w-[100px] h-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 hover:bg-background shadow-sm text-sm font-semibold focus:ring-4 focus:ring-primary/10 transition-all">
                                        <SelectValue placeholder="Year" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl">
                                        {Array.from({ length: 2026 - 2018 + 1 }, (_, i) => 2026 - i).map((y) => (
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
                                                <Button variant="outline" size="icon" onClick={() => fetchData(true)} disabled={loading || isExporting} className="h-12 w-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 hover:bg-secondary hover:text-primary transition-all shadow-sm">
                                                    <Filter className="h-4 w-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-xl font-medium">Reset Filters</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>

                                    <Button onClick={handleExport} disabled={loading || isExporting} className="h-12 px-6 rounded-full gap-2 shadow-lg shadow-primary/25 bg-gradient-to-b from-primary/90 to-primary hover:from-primary hover:to-primary/90 border border-primary/20 flex-1 sm:flex-none text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]">
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
                                        <div className="absolute inset-0 overflow-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                                            <table className="w-full text-sm text-left border-collapse">
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
                                                    {filteredData.length === 0 && !loading ? (
                                                        <TableRow className="border-none hover:bg-transparent">
                                                            <TableCell colSpan={columns.length + 2} className="h-[500px] text-center">
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
                                                        filteredData.map((item, index) => (
                                                            <TableRow
                                                                key={index}
                                                                className="group border-b border-border/20 hover:bg-primary/5 transition-all cursor-pointer"
                                                                onClick={() => {
                                                                    setSelectedItem(item);
                                                                    setIsSheetOpen(true);
                                                                }}
                                                            >
                                                                <TableCell className="text-center font-mono text-xs text-muted-foreground/50 group-hover:text-primary transition-colors py-5">
                                                                    {String(index + 1).padStart(3, '0')}
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
                                                        ))
                                                    )}
                                                </TableBody>
                                            </table>
                                        </div>
                                    </div>
                                    
                                    {(hasMore || loading) && (
                                        <div className="p-4 border-t border-border/30 bg-background/60 backdrop-blur-xl flex justify-center sticky bottom-0 z-20">
                                            <Button
                                                variant="outline"
                                                onClick={(e) => { e.preventDefault(); fetchData(false, cursor); }}
                                                disabled={loading}
                                                className="w-full max-w-md gap-2 font-bold rounded-full h-12 bg-background/50 hover:bg-secondary border-border/50 shadow-sm"
                                            >
                                                {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <TrendingUp className="h-5 w-5 text-primary" />}
                                                {loading ? 'Fetching more records...' : 'Load More Data'}
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
                                <SyncManager year={year} onSyncComplete={() => fetchData(true)} onYearChange={setYear} />
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
