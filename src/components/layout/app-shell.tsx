import { useState, useEffect } from 'react';
import { Database, Home, Settings, Menu, X, FolderSync, TrendingUp, BarChart3, Cloud, PanelLeftOpen, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { FadeIn } from '@/components/ui/motion-primitives';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface NavItem {
    title: string;
    href: string;
    icon: any;
    value: string; // for tab matching
}

const navItems: NavItem[] = [
    { title: 'Overview', href: '#', icon: Home, value: 'browser' },
    { title: 'Sync Manager', href: '#', icon: FolderSync, value: 'sync' },
    { title: 'Range Sync', href: '#', icon: TrendingUp, value: 'range-sync' },
];

export function AppShell({ children, activeTab, onTabChange }: { children: React.ReactNode, activeTab: string, onTabChange: (val: string) => void }) {
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [isCompact, setIsCompact] = useState(false);

    // Persist compact state
    useEffect(() => {
        const saved = localStorage.getItem('sidebar-compact');
        if (saved === 'true') setIsCompact(true);
    }, []);

    const toggleCompact = () => {
        const newState = !isCompact;
        setIsCompact(newState);
        localStorage.setItem('sidebar-compact', String(newState));
    };

    const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
        <div className={cn("flex flex-col h-full bg-secondary/30 backdrop-blur-xl border-r border-border/50 transition-all duration-300 relative group",
            !mobile && isCompact ? "w-[72px]" : "w-72"
        )}>
            {/* Centered Toggle Button */}
            {!mobile && (
                <div className="absolute -right-5 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={toggleCompact}
                        className="h-10 w-10 rounded-full border shadow-sm p-0 hover:bg-primary hover:text-primary-foreground transition-all hover:scale-110"
                        title={isCompact ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        <PanelLeft className={cn("h-6 w-6 transition-transform duration-300", isCompact && "rotate-180")} />
                    </Button>
                </div>
            )}

            <div className={cn("h-16 flex items-center border-b border-border/50 bg-background/50 transition-all duration-300",
                !mobile && isCompact ? "justify-center px-0" : "px-6 justify-between"
            )}>
                <div className={cn("flex items-center gap-3 overflow-hidden transition-all", !mobile && isCompact ? "w-0 opacity-0 absolute" : "w-auto opacity-100")}>
                    <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20 text-primary-foreground shrink-0">
                        <Database className="h-4 w-4" />
                    </div>
                    <span className="font-bold tracking-tight text-lg whitespace-nowrap opacity-100 transition-opacity duration-300 delayed-fade">
                        Inaproc<span className="text-primary ml-1">Viz</span>
                    </span>
                </div>

                {/* Compact Mode Icon (Shown in center when compact) */}
                {!mobile && isCompact && (
                    <div className="h-9 w-9 bg-primary/10 text-primary rounded-lg flex items-center justify-center shrink-0" title="InaprocViz">
                        <Database className="h-5 w-5" />
                    </div>
                )}
            </div>

            <div className="flex-1 py-6 px-3 space-y-2 overflow-y-auto overflow-x-hidden">
                <div className={cn("px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider transition-all duration-300 overflow-hidden whitespace-nowrap", !mobile && isCompact ? "h-0 opacity-0 mb-0" : "h-auto opacity-100")}>
                    Dashboard
                </div>

                <TooltipProvider delayDuration={0}>
                    {navItems.map((item) => {
                        const isActive = activeTab === item.value;
                        return (
                            <div key={item.value} className={cn(!mobile && isCompact && "flex justify-center")}>
                                {(!mobile && isCompact) ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                onClick={() => onTabChange(item.value)}
                                                className={cn(
                                                    "h-10 w-10 p-0 rounded-xl transition-all duration-200 grid place-items-center",
                                                    isActive
                                                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                                )}
                                            >
                                                <item.icon className="h-5 w-5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="font-medium bg-foreground text-background">
                                            {item.title}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <Button
                                        key={item.value}
                                        variant="ghost"
                                        onClick={() => {
                                            onTabChange(item.value);
                                            if (mobile) setIsMobileOpen(false);
                                        }}
                                        className={cn(
                                            "w-full justify-start gap-3 h-11 rounded-xl transition-all duration-200 overflow-hidden",
                                            isActive
                                                ? "bg-primary/10 text-primary font-medium hover:bg-primary/15"
                                                : "text-muted-foreground hover:bg-white/50 hover:text-foreground dark:hover:bg-zinc-800/50"
                                        )}
                                    >
                                        <item.icon className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "opacity-70")} />
                                        <span className="whitespace-nowrap transition-all duration-300 opacity-100">
                                            {item.title}
                                        </span>
                                        {isActive && (
                                            <motion.div
                                                layoutId="active-nav"
                                                className="absolute left-0 w-1 h-6 bg-primary rounded-r-full"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ duration: 0.2 }}
                                            />
                                        )}
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </TooltipProvider>
            </div>

            <div className="p-4 border-t border-border/50 bg-background/30">
                {(!mobile && isCompact) ? (
                    <Button variant="ghost" size="icon" className="w-full justify-center text-muted-foreground">
                        <Settings className="h-5 w-5" />
                    </Button>
                ) : (
                    <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground overflow-hidden">
                        <Settings className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">Settings</span>
                    </Button>
                )}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-background flex">
            {/* Desktop Sidebar */}
            <aside className={cn(
                "hidden md:block shrink-0 h-screen sticky top-0 z-30 transition-all duration-300 ease-in-out border-r border-border/50 bg-background",
                isCompact ? "w-[80px]" : "w-72"
            )}>
                <SidebarContent />
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-h-screen relative overflow-hidden transition-all duration-300">
                {/* Mobile Header */}
                <header className="md:hidden h-16 border-b border-border/50 glass sticky top-0 z-40 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="h-7 w-7 bg-primary rounded-md flex items-center justify-center text-primary-foreground">
                            <Database className="h-4 w-4" />
                        </div>
                        <span className="font-bold">InaprocViz</span>
                    </div>
                    <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0 w-72 border-r border-border/50 bg-background/80 backdrop-blur-xl">
                            <SidebarContent mobile />
                        </SheetContent>
                    </Sheet>
                </header>

                <main className="flex-1 w-full h-full p-4 md:p-6 lg:p-8 space-y-8 animate-in fade-in duration-500 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}
