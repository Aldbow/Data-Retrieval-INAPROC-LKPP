import { supabase } from './supabase';

export interface EndpointSyncState {
    lastCursor: string | null;
    lastSyncDate: string;
    totalRecords: number;
    filePath: string;
}

export interface SyncStateStore {
    [endpoint: string]: {
        [year: string]: EndpointSyncState;
    };
}

export interface ScheduleConfig {
    enabled: boolean;
    type: 'daily' | 'weekly';
    lastRun: string | null;
    endpoints: string[];
}

export interface FullSyncState {
    syncState: SyncStateStore;
    schedule: ScheduleConfig;
}

// These are no-ops for Serverless (Supabase doesn't need local folders)
export async function ensureBaseDirectory(): Promise<void> {
    return;
}

export async function ensureEndpointFolder(endpoint: string): Promise<string> {
    return `/tmp/${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export async function loadFullSyncState(): Promise<FullSyncState> {
    const { data: states, error } = await supabase
        .from('sync_states')
        .select('*');

    const syncState: SyncStateStore = {};

    if (!error && states) {
        for (const row of states) {
            if (!syncState[row.endpoint]) syncState[row.endpoint] = {};
            syncState[row.endpoint][row.year] = {
                lastCursor: row.last_cursor,
                totalRecords: row.total_records,
                filePath: row.file_path || '',
                lastSyncDate: row.updated_at,
            };
        }
    }

    // Schedule config is currently not stored in Supabase, we can return defaults 
    // since Vercel Cron will handle the schedule.
    return {
        syncState,
        schedule: {
            enabled: true,
            type: 'daily',
            lastRun: null,
            endpoints: [],
        },
    };
}

export async function getSyncState(
    endpoint: string,
    year: string
): Promise<EndpointSyncState | null> {
    const { data, error } = await supabase
        .from('sync_states')
        .select('*')
        .eq('endpoint', endpoint)
        .eq('year', year)
        .maybeSingle();

    if (error || !data) return null;

    return {
        lastCursor: data.last_cursor,
        totalRecords: data.total_records,
        filePath: data.file_path || '',
        lastSyncDate: data.updated_at,
    };
}

export async function updateSyncState(
    endpoint: string,
    year: string,
    update: Partial<EndpointSyncState>
): Promise<void> {
    // We must upsert
    const current = await getSyncState(endpoint, year);
    const newTotal = update.totalRecords !== undefined ? update.totalRecords : (current?.totalRecords || 0);
    const newCursor = update.lastCursor !== undefined ? update.lastCursor : (current?.lastCursor || null);
    const newPath = update.filePath !== undefined ? update.filePath : (current?.filePath || '');

    await supabase
        .from('sync_states')
        .upsert({
            endpoint,
            year,
            last_cursor: newCursor,
            total_records: newTotal,
            file_path: newPath,
            updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint, year' });
}

export async function getAllSyncStates(): Promise<SyncStateStore> {
    const fullState = await loadFullSyncState();
    return fullState.syncState;
}

export async function getScheduleConfig(): Promise<ScheduleConfig> {
    const fullState = await loadFullSyncState();
    return fullState.schedule;
}

export async function updateScheduleConfig(
    update: Partial<ScheduleConfig>
): Promise<void> {
    // No-op, managed by Vercel cron
}

export async function isScheduledSyncDue(): Promise<boolean> {
    return false; // Managed by Vercel cron
}

export async function resetSyncState(
    endpoint: string,
    year: string
): Promise<void> {
    await supabase
        .from('sync_states')
        .delete()
        .eq('endpoint', endpoint)
        .eq('year', year);
}
