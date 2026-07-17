
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface DetailSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    data: any | null;
}

export function DetailSheet({ open, onOpenChange, data }: DetailSheetProps) {
    if (!data) return null;

    // Helper to format currency
    const formatCurrency = (val: any) => {
        const num = parseFloat(val);
        if (isNaN(num)) return val;
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(num);
    };

    // Helper to format date
    const formatDate = (val: string) => {
        try {
            return new Date(val).toLocaleDateString('id-ID', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return val;
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[90vw] sm:max-w-[850px] sm:w-[850px] border-l border-border/50 shadow-2xl bg-background/95 backdrop-blur-xl p-0 flex flex-col gap-0">
                {/* Header */}
                <div className="p-6 pb-2">
                    <SheetHeader>
                        <div className="space-y-1">
                            <Badge variant="outline" className="w-fit mb-2 border-primary/20 bg-primary/5 text-primary">
                                {data.kode_rup || 'N/A'}
                            </Badge>
                            <SheetTitle className="text-xl font-bold leading-relaxed text-foreground">
                                {data.nama_paket}
                            </SheetTitle>
                            <SheetDescription className="text-sm text-muted-foreground flex items-center gap-2">
                                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                {data.sumber_dana || 'Sumber Dana N/A'}
                            </SheetDescription>
                        </div>
                    </SheetHeader>
                </div>

                <div className="flex-1 overflow-hidden relative">
                    <ScrollArea className="h-full w-full">
                        <div className="p-6 pt-2 space-y-8">

                            {/* Key Metrics Cards */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/10 shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <div className="h-12 w-12 rounded-full bg-emerald-500 blur-xl" />
                                    </div>
                                    <p className="text-[10px] font-bold tracking-wider text-emerald-700 dark:text-emerald-300 uppercase mb-1">Pagu Anggaran</p>
                                    <p className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
                                        {formatCurrency(data.pagu)}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/10 shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <div className="h-12 w-12 rounded-full bg-blue-500 blur-xl" />
                                    </div>
                                    <p className="text-[10px] font-bold tracking-wider text-blue-700 dark:text-blue-300 uppercase mb-1">
                                        {data.nilai_kontrak ? 'Nilai Kontrak' : 'HPS'}
                                    </p>
                                    <p className="font-mono text-lg font-bold text-blue-600 dark:text-blue-400">
                                        {data.nilai_kontrak ? formatCurrency(data.nilai_kontrak) : (data.total_harga ? formatCurrency(data.total_harga) : '-')}
                                    </p>
                                </div>
                            </div>

                            {/* Organization Info */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-1 bg-primary rounded-full" />
                                    <h3 className="text-sm font-semibold">Informasi Instansi</h3>
                                </div>
                                <div className="bg-secondary/30 rounded-xl p-1">
                                    <div className="grid gap-px bg-border/50 rounded-lg overflow-hidden">
                                        <div className="grid grid-cols-3 gap-4 bg-background p-3 text-sm">
                                            <span className="text-muted-foreground font-medium">KLPD</span>
                                            <span className="col-span-2 font-medium">{data.nama_klpd}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 bg-background p-3 text-sm">
                                            <span className="text-muted-foreground font-medium">Satuan Kerja</span>
                                            <span className="col-span-2 font-medium">{data.nama_satker}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 bg-background p-3 text-sm">
                                            <span className="text-muted-foreground font-medium">Lokasi</span>
                                            <span className="col-span-2 font-medium">{data.lokasi_pekerjaan || '-'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Separator className="bg-border/50" />

                            {/* Raw Data List */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-1 bg-primary rounded-full" />
                                    <h3 className="text-sm font-semibold">Data Lengkap</h3>
                                </div>
                                <div className="rounded-xl border border-border/50 overflow-hidden text-sm">
                                    {Object.entries(data).map(([key, value], index) => {
                                        if (['nama_paket', 'pagu', 'kode_rup', 'nama_klpd', 'nama_satker'].includes(key)) return null;

                                        let displayValue = value;
                                        if (typeof value === 'object' && value !== null) {
                                            displayValue = JSON.stringify(value);
                                        }
                                        if (key.includes('pagu') || key.includes('harga')) {
                                            displayValue = formatCurrency(value);
                                        }
                                        if (key.includes('tanggal') || key.includes('waktu')) {
                                            displayValue = formatDate(value as string);
                                        }

                                        return (
                                            <div
                                                key={key}
                                                className={`grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 p-3 ${index % 2 === 0 ? 'bg-background' : 'bg-secondary/20'
                                                    } border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors`}
                                            >
                                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate" title={key}>
                                                    {key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                                </span>
                                                <span className="font-mono text-xs opacity-90 break-words">
                                                    {String(displayValue)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </ScrollArea>
                </div>

                {/* Footer/Gradient fade */}
                <div className="h-6 bg-gradient-to-t from-background to-transparent pointer-events-none absolute bottom-0 w-full" />
            </SheetContent>
        </Sheet>
    );
}
