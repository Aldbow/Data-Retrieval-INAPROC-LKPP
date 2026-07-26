'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    Search,
    Filter,
    Database,
    TrendingUp,
    DollarSign,
    Eye,
    Download,
    AlertTriangle,
    Activity,
    Box,
    FileJson,
    FileText,
    FileSpreadsheet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DetailSheet } from '@/components/detail-sheet';
import { SyncManager } from '@/components/sync-manager';
import { RangeSyncManager } from '@/components/range-sync-manager';
import { getEndpoint, getEndpointTree } from '@/lib/endpoint-registry';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/layout/app-shell';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/skeleton';

type ExportFormat = 'json' | 'csv' | 'xlsx';
type Row = Record<string, unknown>;

interface PageResult {
    data: Row[];
    cursor: string | null;
    has_more: boolean;
}

const ROW_HEIGHT = 64;
const SEARCH_DEBOUNCE_MS = 300;

/** Fields that represent money, for currency formatting and the pagu total. */
const VALUE_KEYS = ['total_harga', 'pagu', 'nilai_kontrak', 'nilai_pagu_paket', 'total_pagu', 'total_nilai'];

const EXPORT_FORMATS: { id: ExportFormat; label: string; icon: typeof FileJson }[] = [
    { id: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
    { id: 'csv', label: 'CSV (.csv)', icon: FileText },
    { id: 'json', label: 'JSON (.json)', icon: FileJson },
];

/** Delays a value so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}

export default function Home() {
    const endpointTree = useMemo(() => getEndpointTree(), []);
    const [selectedEndpoint, setSelectedEndpoint] = useState('/v1/rup/paket-penyedia-terumumkan');
    const [activeTab, setActiveTab] = useState('browser');
    const [year, setYear] = useState('2026');
    const [searchInput, setSearchInput] = useState('');
    const [selectedItem, setSelectedItem] = useState<Row | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx');
    const parentRef = useRef<HTMLDivElement>(null);

    // Debounced so filtering large result sets does not run on every keystroke.
    const search = useDebounced(searchInput.trim().toLowerCase(), SEARCH_DEBOUNCE_MS);

    const definition = getEndpoint(selectedEndpoint);
    const isBrowsable = definition?.status === 'ready';

    const {
        data: queryData,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        isError,
        refetch,
    } = useInfiniteQuery<PageResult>({
        // `search` is not part of the key: filtering happens on already-loaded
        // rows, so typing must not discard them and re-request from the API.
        queryKey: ['inaproc', selectedEndpoint, year],
        queryFn: async ({ pageParam }) => {
            const query = new URLSearchParams({ endpoint: selectedEndpoint, limit: '50' });
            if (definition?.yearScoped) query.set('year', year);
            if (pageParam) query.set('cursor', String(pageParam));

            const res = await fetch(`/api/inaproc?${query.toString()}`);
            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.error || 'Gagal mengambil data');
            }
            return res.json();
        },
        getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.cursor ?? undefined : undefined),
        enabled: isBrowsable,
        initialPageParam: null as string | null,
    });

    const allRows = useMemo(
        () => queryData?.pages.flatMap((page) => page.data ?? []) ?? [],
        [queryData],
    );

    const rows = useMemo(() => {
        if (!search) return allRows;
        return allRows.filter((row) =>
            Object.values(row).some(
                (value) => value !== null && value !== undefined && String(value).toLowerCase().includes(search),
            ),
        );
    }, [allRows, search]);

    // Scan every loaded row: sampling the first few dropped columns that only
    // appear later in the dataset.
    const columns = useMemo(() => {
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                if (!seen.has(key)) {
                    seen.add(key);
                    ordered.push(key);
                }
            }
        }
        return ordered;
    }, [rows]);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();
    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
    const paddingBottom =
        virtualItems.length > 0
            ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
            : 0;

    const stats = useMemo(() => {
        const totalValue = rows.reduce((sum, row) => {
            for (const key of VALUE_KEYS) {
                if (row[key] !== undefined && row[key] !== null) {
                    return sum + (parseFloat(String(row[key])) || 0);
                }
            }
            return sum;
        }, 0);

        return { loaded: rows.length, totalLoaded: allRows.length, totalValue };
    }, [rows, allRows]);

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

    const handleExport = async () => {
        setIsExporting(true);
        const toastId = toast.loading(`Menyiapkan ekspor ${exportFormat.toUpperCase()}...`);

        try {
            const query = new URLSearchParams({ endpoint: selectedEndpoint, format: exportFormat });
            if (definition?.yearScoped) query.set('year', year);
            if (search) query.set('search', search);

            const res = await fetch(`/api/export?${query.toString()}`);
            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.error || 'Gagal membuat file ekspor');
            }

            const source = res.headers.get('X-Export-Source');
            const exported = res.headers.get('X-Export-Rows');
            const truncated = res.headers.get('X-Export-Truncated') === 'true';

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download =
                res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ??
                `INAPROC_export.${exportFormat}`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            window.URL.revokeObjectURL(url);

            const origin = source === 'local' ? 'file lokal' : 'API langsung';
            if (truncated) {
                // Say so rather than handing over a quietly short file.
                toast.warning(
                    `Ekspor dipotong pada ${Number(exported).toLocaleString('id-ID')} baris (batas pengambilan langsung). Sinkronkan endpoint ini untuk ekspor penuh.`,
                    { id: toastId, duration: 8000 },
                );
            } else {
                toast.success(
                    `Ekspor selesai: ${Number(exported).toLocaleString('id-ID')} baris dari ${origin}`,
                    { id: toastId },
                );
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Ekspor gagal', { id: toastId });
        } finally {
            setIsExporting(false);
        }
    };

    const renderCell = (key: string, value: unknown) => {
        if (value === null || value === undefined) {
            return <span className="text-muted-foreground/30 font-light">&mdash;</span>;
        }
        if (typeof value === 'number' && VALUE_KEYS.some((k) => key.includes(k.split('_').pop()!))) {
            return (
                <span className="font-mono text-emerald-500 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-md">
                    {formatCurrency(value)}
                </span>
            );
        }
        if (typeof value === 'string' && key.includes('status')) {
            return (
                <Badge variant="secondary" className="font-medium text-[11px] px-3 py-1 rounded-full bg-secondary/80 text-foreground">
                    {value}
                </Badge>
            );
        }
        if (typeof value === 'object') {
            return <span className="italic text-xs opacity-50">JSON</span>;
        }
        return <span title={String(value)}>{String(value)}</span>;
    };

    return (
        <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
            <DetailSheet open={isSheetOpen} onOpenChange={setIsSheetOpen} data={selectedItem} />

            <AnimatePresence mode="wait">
                {activeTab === 'browser' && (
                    <motion.div
                        key="browser"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full flex flex-col"
                    >
                        {/* Summary cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.1, duration: 0.5 }}
                                className="md:col-span-2 relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-8 group hover:border-primary/30 transition-colors"
                            >
                                <div className="absolute -top-12 -right-12 p-8 opacity-5 pointer-events-none">
                                    <DollarSign className="w-64 h-64 text-primary" />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shadow-inner">
                                            <TrendingUp className="w-5 h-5" />
                                        </div>
                                        {/* Scoped to loaded rows, not the whole dataset -- say so plainly. */}
                                        <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-sm">
                                            Nilai Baris Termuat
                                        </h3>
                                    </div>
                                    <div className="mt-4 flex items-end gap-3">
                                        <h1
                                            suppressHydrationWarning
                                            className="text-4xl sm:text-6xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 via-emerald-600 to-primary drop-shadow-sm"
                                        >
                                            {formatCurrency(stats.totalValue).replace('Rp', '').trim()}
                                        </h1>
                                        <span className="text-xl text-muted-foreground mb-2 font-medium bg-background/50 px-3 py-1 rounded-lg backdrop-blur-md">
                                            IDR
                                        </span>
                                    </div>
                                    <p suppressHydrationWarning className="mt-6 text-muted-foreground font-medium text-sm">
                                        Jumlah dari {stats.loaded.toLocaleString('id-ID')} baris yang sudah dimuat
                                        {definition?.yearScoped ? ` untuk tahun ${year}` : ''} — bukan total keseluruhan
                                        dataset. Muat lebih banyak data untuk angka yang lebih lengkap.
                                    </p>
                                </div>
                            </motion.div>

                            <div className="grid grid-rows-2 gap-6">
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.2, duration: 0.5 }}
                                    className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 flex flex-col justify-between"
                                >
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                                            Baris Termuat
                                        </h3>
                                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                            <Database className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <h2 suppressHydrationWarning className="text-4xl font-bold tracking-tight text-foreground/90">
                                            {stats.loaded.toLocaleString('id-ID')}
                                        </h2>
                                        <p className="text-sm text-muted-foreground mt-2 font-medium">
                                            {search
                                                ? `terfilter dari ${stats.totalLoaded.toLocaleString('id-ID')} baris`
                                                : hasNextPage
                                                    ? 'masih ada data berikutnya'
                                                    : 'seluruh data sudah dimuat'}
                                        </p>
                                    </div>
                                </motion.div>

                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.3, duration: 0.5 }}
                                    className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl shadow-primary/5 p-6 flex flex-col justify-between"
                                >
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                                            Status API
                                        </h3>
                                        <div className={cn('p-2 rounded-xl', isError ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500')}>
                                            <Activity className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="mt-4 flex items-center gap-4">
                                        <span className="relative flex h-5 w-5">
                                            <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', isError ? 'bg-rose-400' : 'bg-emerald-400')} />
                                            <span className={cn('relative inline-flex rounded-full h-5 w-5', isError ? 'bg-rose-500' : 'bg-emerald-500')} />
                                        </span>
                                        <h2 className={cn('text-2xl font-bold tracking-tight', isError ? 'text-rose-500' : 'text-emerald-500')}>
                                            {isError ? 'Gangguan' : 'Normal'}
                                        </h2>
                                    </div>
                                </motion.div>
                            </div>
                        </div>

                        {/* Command bar */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="sticky top-20 z-30 mb-8 flex flex-col xl:flex-row items-center justify-between gap-4 bg-background/80 backdrop-blur-3xl border border-border/60 p-2 sm:p-3 rounded-[2rem] shadow-xl shadow-black/5 ring-1 ring-black/5 dark:ring-white/5"
                        >
                            <div className="relative w-full xl:max-w-[420px] flex-shrink-0 group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <Search className="h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                </div>
                                <Input
                                    placeholder="Cari di dalam data yang sudah dimuat..."
                                    className="w-full pl-11 bg-black/5 dark:bg-white/5 border border-transparent hover:border-black/10 dark:hover:border-white/10 focus-visible:border-primary/30 shadow-inner rounded-full text-sm h-12 transition-all focus-visible:ring-4 focus-visible:ring-primary/10"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                />
                                {searchInput && (
                                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                                        <span className="text-[10px] font-mono text-muted-foreground">
                                            {rows.length.toLocaleString('id-ID')} cocok
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full xl:w-auto">
                                <Select value={year} onValueChange={setYear} disabled={!definition?.yearScoped}>
                                    <SelectTrigger className="w-full sm:w-[100px] h-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 shadow-sm text-sm font-semibold disabled:opacity-40">
                                        <SelectValue placeholder="Tahun" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl">
                                        {Array.from({ length: 2027 - 2018 + 1 }, (_, i) => 2027 - i).map((y) => (
                                            <SelectItem key={y} value={String(y)} className="rounded-xl cursor-pointer font-medium">
                                                {y}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* Two-level grouping: section, then category. */}
                                <Select value={selectedEndpoint} onValueChange={setSelectedEndpoint}>
                                    <SelectTrigger className="w-full sm:w-[320px] h-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 shadow-sm text-sm font-medium px-5 truncate">
                                        <SelectValue placeholder="Pilih Endpoint" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl max-h-[460px]">
                                        {endpointTree.map((section, sectionIndex) => (
                                            <div key={section.title}>
                                                {sectionIndex > 0 && <SelectSeparator />}
                                                <SelectGroup>
                                                    <SelectLabel className="text-primary/70 font-bold text-[10px] uppercase tracking-widest px-3 py-2">
                                                        {section.title} · {section.count}
                                                    </SelectLabel>
                                                </SelectGroup>
                                                {section.categories.map((category) => (
                                                    <SelectGroup key={`${section.title}-${category.name}`}>
                                                        <SelectLabel className="text-muted-foreground/60 font-semibold text-[10px] uppercase tracking-wider px-3 pt-2 pb-1">
                                                            {category.name}
                                                        </SelectLabel>
                                                        {category.endpoints.map((ep) => (
                                                            <SelectItem
                                                                key={ep.value}
                                                                value={ep.value}
                                                                className="rounded-xl cursor-pointer py-2 text-sm"
                                                            >
                                                                <span className="flex items-center gap-2">
                                                                    {ep.status !== 'ready' && (
                                                                        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                                                                    )}
                                                                    {ep.label}
                                                                </span>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                ))}
                                            </div>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as ExportFormat)}>
                                    <SelectTrigger className="w-full sm:w-[150px] h-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 shadow-sm text-sm font-semibold">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl shadow-xl">
                                        {EXPORT_FORMATS.map(({ id, label, icon: Icon }) => (
                                            <SelectItem key={id} value={id} className="rounded-xl cursor-pointer font-medium">
                                                <span className="flex items-center gap-2">
                                                    <Icon className="h-4 w-4" />
                                                    {label}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => {
                                                        setSearchInput('');
                                                        refetch();
                                                    }}
                                                    disabled={isLoading}
                                                    className="h-12 w-12 rounded-full border border-black/10 dark:border-white/10 bg-background/50 hover:bg-secondary hover:text-primary shadow-sm"
                                                >
                                                    <Filter className="h-4 w-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-xl font-medium">Reset & muat ulang</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>

                                    <Button
                                        onClick={handleExport}
                                        disabled={isExporting || !definition}
                                        className="h-12 px-6 rounded-full gap-2 shadow-lg shadow-primary/25 bg-gradient-to-b from-primary/90 to-primary border border-primary/20 flex-1 sm:flex-none text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        {isExporting ? 'Mengekspor...' : 'Ekspor'}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>

                        {/* Data table */}
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                            {!isBrowsable ? (
                                <div className="border-2 border-dashed border-amber-500/20 bg-amber-500/5 rounded-[2.5rem] p-16 flex flex-col items-center justify-center text-center gap-6">
                                    <div className="h-24 w-24 bg-amber-500/10 rounded-full flex items-center justify-center">
                                        <AlertTriangle className="h-12 w-12 text-amber-500" />
                                    </div>
                                    <div className="max-w-lg space-y-3">
                                        <h3 className="font-bold text-2xl">
                                            {definition?.status === 'requires-id' ? 'Parameter ID Diperlukan' : 'Parameter Belum Diketahui'}
                                        </h3>
                                        <p className="text-muted-foreground text-lg">
                                            {definition?.status === 'requires-id'
                                                ? 'Endpoint ini hanya bisa diakses per record, dengan ID spesifik seperti kd_penyedia atau kd_komoditas.'
                                                : 'API menolak endpoint ini (HTTP 400) untuk semua kombinasi parameter yang sudah dicoba. Diperlukan parameter wajib yang belum terdokumentasi.'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-[2.5rem] border border-border/50 bg-card/30 backdrop-blur-xl shadow-xl overflow-hidden flex flex-col h-[700px] relative">
                                    <div className="p-0 flex-1 overflow-hidden relative">
                                        <div ref={parentRef} className="absolute inset-0 overflow-auto">
                                            <table className="w-full text-sm text-left border-collapse relative">
                                                <TableHeader className="sticky top-0 z-20 bg-background/80 backdrop-blur-2xl">
                                                    <TableRow className="border-none hover:bg-transparent">
                                                        <TableHead className="w-[80px] text-center font-bold text-muted-foreground uppercase tracking-wider text-xs py-6">
                                                            #
                                                        </TableHead>
                                                        {columns.map((key) => (
                                                            <TableHead
                                                                key={key}
                                                                className="whitespace-nowrap font-bold text-foreground/80 py-6 px-6 min-w-[180px] uppercase tracking-wider text-xs"
                                                            >
                                                                {key.replace(/_/g, ' ')}
                                                            </TableHead>
                                                        ))}
                                                        <TableHead className="w-[80px]" />
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {isLoading ? (
                                                        Array.from({ length: 10 }).map((_, index) => (
                                                            <TableRow key={index} className="border-b border-border/20">
                                                                <TableCell className="py-5">
                                                                    <Skeleton className="h-4 w-8 mx-auto" />
                                                                </TableCell>
                                                                <TableCell colSpan={Math.max(columns.length, 5)} className="px-6 py-5">
                                                                    <Skeleton className="h-4 w-full" />
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Skeleton className="h-8 w-8 rounded-full ml-auto" />
                                                                </TableCell>
                                                            </TableRow>
                                                        ))
                                                    ) : rows.length === 0 ? (
                                                        <TableRow className="border-none hover:bg-transparent">
                                                            <TableCell colSpan={columns.length + 2 || 6} className="h-[500px] text-center">
                                                                <div className="flex flex-col items-center justify-center gap-4">
                                                                    <div className="h-20 w-20 bg-muted/50 rounded-3xl flex items-center justify-center mb-2">
                                                                        <Box className="h-10 w-10 text-muted-foreground opacity-50" />
                                                                    </div>
                                                                    <h3 className="text-xl font-bold">
                                                                        {search ? 'Tidak ada yang cocok' : 'Tidak ada data'}
                                                                    </h3>
                                                                    <p className="text-muted-foreground">
                                                                        {search
                                                                            ? 'Coba kata kunci lain, atau muat lebih banyak data dulu.'
                                                                            : isError
                                                                                ? 'Permintaan ke API gagal. Coba muat ulang.'
                                                                                : 'Endpoint dan tahun ini tidak mengembalikan data.'}
                                                                    </p>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        <>
                                                            {paddingTop > 0 && (
                                                                <tr>
                                                                    <td style={{ height: paddingTop }} />
                                                                </tr>
                                                            )}
                                                            {virtualItems.map((virtualRow) => {
                                                                const item = rows[virtualRow.index];
                                                                return (
                                                                    <TableRow
                                                                        key={virtualRow.key}
                                                                        style={{ height: ROW_HEIGHT }}
                                                                        className="group border-b border-border/20 hover:bg-primary/5 transition-all cursor-pointer"
                                                                        onClick={() => {
                                                                            setSelectedItem(item);
                                                                            setIsSheetOpen(true);
                                                                        }}
                                                                    >
                                                                        <TableCell className="text-center font-mono text-xs text-muted-foreground/50 group-hover:text-primary">
                                                                            {String(virtualRow.index + 1).padStart(3, '0')}
                                                                        </TableCell>
                                                                        {columns.map((key) => (
                                                                            <TableCell
                                                                                key={key}
                                                                                className="px-6 max-w-[350px] truncate text-muted-foreground group-hover:text-foreground font-medium"
                                                                            >
                                                                                {renderCell(key, item[key])}
                                                                            </TableCell>
                                                                        ))}
                                                                        <TableCell className="pr-6 text-right">
                                                                            <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                <div className="h-9 w-9 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-md shadow-primary/30">
                                                                                    <Eye className="h-4 w-4" />
                                                                                </div>
                                                                            </div>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                            {paddingBottom > 0 && (
                                                                <tr>
                                                                    <td style={{ height: paddingBottom }} />
                                                                </tr>
                                                            )}
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
                                                onClick={() => fetchNextPage()}
                                                disabled={isFetchingNextPage || isLoading}
                                                className="w-full max-w-md gap-2 font-bold rounded-full h-12 bg-background/50 hover:bg-secondary border-border/50 shadow-sm"
                                            >
                                                {isFetchingNextPage ? (
                                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                                ) : (
                                                    <TrendingUp className="h-5 w-5 text-primary" />
                                                )}
                                                {isFetchingNextPage ? 'Mengambil data...' : 'Muat Lebih Banyak'}
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
                                <p className="text-muted-foreground mt-2 font-medium">
                                    Sinkronkan data ke penyimpanan lokal dalam format JSON, CSV, dan XLSX
                                </p>
                            </div>
                            <SyncManager year={year} onSyncComplete={() => refetch()} onYearChange={setYear} />
                        </div>
                    </motion.div>
                )}

                {activeTab === 'range-sync' && (
                    <motion.div key="range-sync" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full">
                        <div className="flex flex-col gap-6 mb-8">
                            <div>
                                <h2 className="text-3xl font-extrabold tracking-tight">Range Sync Manager</h2>
                                <p className="text-muted-foreground mt-2 font-medium">
                                    Sinkronisasi massal lintas tahun dan endpoint
                                </p>
                            </div>
                            <RangeSyncManager />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </AppShell>
    );
}
