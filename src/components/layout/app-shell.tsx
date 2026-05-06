import { useState, useEffect } from 'react';
import { Database, Home, Settings, FolderSync, TrendingUp, Bell, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface NavItem {
    title: string;
    href: string;
    icon: any;
    value: string;
}

const navItems: NavItem[] = [
    { title: 'Overview', href: '#', icon: Home, value: 'browser' },
    { title: 'Sync Manager', href: '#', icon: FolderSync, value: 'sync' },
    { title: 'Range Sync', href: '#', icon: TrendingUp, value: 'range-sync' },
];

export function AppShell({ children, activeTab, onTabChange }: { children: React.ReactNode, activeTab: string, onTabChange: (val: string) => void }) {
    const [scrolled, setScrolled] = useState(false);
    
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col relative overflow-hidden selection:bg-primary/30">
            {/* Ambient Background Glows */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] mix-blend-screen" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[120px] mix-blend-screen" />
            </div>

            {/* Top Command Bar (Header) */}
            <header className={cn(
                "fixed top-0 left-0 right-0 z-40 transition-all duration-300",
                scrolled ? "py-2" : "py-4"
            )}>
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-[1800px]">
                    <div className={cn(
                        "flex items-center justify-between px-4 sm:px-6 transition-all duration-500 rounded-full border shadow-sm backdrop-blur-xl",
                        scrolled ? "bg-background/80 border-border/50 h-14" : "bg-background/50 border-transparent shadow-none h-16"
                    )}>
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 bg-gradient-to-tr from-primary to-primary/60 rounded-xl flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 shrink-0">
                                <Database className="h-4 w-4" />
                            </div>
                            <span className="font-extrabold tracking-tight text-lg hidden sm:block">
                                Inaproc<span className="text-primary font-normal">Viz</span>
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" className="rounded-full hover:bg-secondary">
                                <Bell className="h-5 w-5 opacity-70" />
                            </Button>
                            <Button variant="ghost" size="icon" className="rounded-full hover:bg-secondary">
                                <User className="h-5 w-5 opacity-70" />
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Workspace */}
            <main className="flex-1 w-full pt-28 pb-32 z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-[1800px]">
                {children}
            </main>

            {/* Floating Bottom Dock */}
            <div className="fixed bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                <div className="pointer-events-auto p-1.5 bg-background/70 backdrop-blur-[24px] border border-border/50 rounded-full shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)] flex items-center gap-1 mx-auto transition-all">
                    <TooltipProvider delayDuration={0}>
                        {navItems.map((item) => {
                            const isActive = activeTab === item.value;
                            return (
                                <Tooltip key={item.value}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => onTabChange(item.value)}
                                            className={cn(
                                                "relative group flex items-center justify-center h-10 w-10 sm:w-12 sm:h-12 rounded-full transition-all duration-300 outline-none",
                                                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/10"
                                            )}
                                        >
                                            <item.icon className={cn(
                                                "h-4 w-4 sm:h-5 sm:w-5 transition-transform duration-300",
                                                isActive ? "scale-110" : "group-hover:scale-110 group-hover:-translate-y-0.5"
                                            )} />
                                            {isActive && (
                                                <motion.div
                                                    layoutId="dock-indicator"
                                                    className="absolute inset-0 bg-primary/10 rounded-full z-[-1]"
                                                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                                />
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={20} className="font-semibold px-3 py-1.5 rounded-xl bg-foreground text-background">
                                        {item.title}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })}
                    </TooltipProvider>
                </div>
            </div>
        </div>
    );
}
