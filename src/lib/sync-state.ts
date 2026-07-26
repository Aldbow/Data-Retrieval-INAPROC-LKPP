/**
 * Sync State
 *
 * Tracks the pagination cursor and row count per endpoint/year so an
 * interrupted sync can resume where it stopped.
 *
 * All mutations run through a promise queue. The state file is a single
 * read-modify-write document, so two concurrent syncs (two browser tabs, or a
 * range sync overlapping a manual one) would otherwise clobber each other's
 * cursors and lose progress.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SYNC_STATE_FILE } from './drive-config';
import { isKnownEndpoint } from './endpoint-registry';

export interface EndpointSyncState {
    lastCursor: string | null;
    lastSyncDate: string;
    totalRecords: number;
    /** Set when the last attempt ended without reaching the end of the data. */
    incomplete?: boolean;
}

export type SyncStateStore = Record<string, Record<string, EndpointSyncState>>;

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

function defaultState(): FullSyncState {
    return {
        syncState: {},
        schedule: { enabled: false, type: 'daily', lastRun: null, endpoints: [] },
    };
}

/**
 * Serialises every state mutation. Each caller chains onto the previous
 * operation, so read-modify-write sequences cannot interleave.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation, operation);
    // Keep the chain alive even if this operation rejects.
    writeQueue = result.catch(() => undefined);
    return result;
}

async function readState(): Promise<FullSyncState> {
    try {
        const raw = await fs.readFile(SYNC_STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<FullSyncState>;
        const base = defaultState();

        return {
            syncState: parsed.syncState ?? base.syncState,
            schedule: { ...base.schedule, ...parsed.schedule },
        };
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            console.error('[sync-state] Falling back to defaults, could not read state:', error);
        }
        return defaultState();
    }
}

async function writeState(state: FullSyncState): Promise<void> {
    await fs.mkdir(path.dirname(SYNC_STATE_FILE), { recursive: true });

    const tmp = `${SYNC_STATE_FILE}.${process.pid}.tmp`;
    try {
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
        await fs.rename(tmp, SYNC_STATE_FILE);
    } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
    }
}

/** Key used for endpoints that are not year-scoped. */
export const NO_YEAR = '_all';

export async function loadFullSyncState(): Promise<FullSyncState> {
    return enqueue(readState);
}

export async function getSyncState(endpoint: string, year: string): Promise<EndpointSyncState | null> {
    const state = await enqueue(readState);
    return state.syncState[endpoint]?.[year] ?? null;
}

export async function updateSyncState(
    endpoint: string,
    year: string,
    update: Partial<EndpointSyncState>,
): Promise<void> {
    await enqueue(async () => {
        const state = await readState();
        const forEndpoint = state.syncState[endpoint] ?? {};
        const previous = forEndpoint[year] ?? {
            lastCursor: null,
            lastSyncDate: new Date().toISOString(),
            totalRecords: 0,
        };

        state.syncState[endpoint] = {
            ...forEndpoint,
            [year]: { ...previous, ...update, lastSyncDate: new Date().toISOString() },
        };

        await writeState(state);
    });
}

export async function resetSyncState(endpoint: string, year: string): Promise<void> {
    await enqueue(async () => {
        const state = await readState();
        const forEndpoint = state.syncState[endpoint];
        if (!forEndpoint?.[year]) return;

        delete forEndpoint[year];
        if (Object.keys(forEndpoint).length === 0) {
            delete state.syncState[endpoint];
        }

        await writeState(state);
    });
}

/**
 * All recorded sync states, with entries for endpoints no longer in the
 * registry filtered out so a renamed endpoint cannot linger in the UI.
 */
export async function getAllSyncStates(): Promise<SyncStateStore> {
    const state = await enqueue(readState);

    return Object.fromEntries(
        Object.entries(state.syncState).filter(([endpoint]) => isKnownEndpoint(endpoint)),
    );
}

export async function getScheduleConfig(): Promise<ScheduleConfig> {
    const state = await enqueue(readState);
    return state.schedule;
}

export async function updateScheduleConfig(update: Partial<ScheduleConfig>): Promise<void> {
    await enqueue(async () => {
        const state = await readState();
        state.schedule = { ...state.schedule, ...update };
        await writeState(state);
    });
}

/**
 * Whether an enabled schedule is overdue.
 *
 * Note: nothing currently acts on this. Running syncs on a timer needs a
 * process that outlives a request, which this app does not have -- the
 * scheduling UI is hidden until that exists.
 */
export async function isScheduledSyncDue(): Promise<boolean> {
    const schedule = await getScheduleConfig();
    if (!schedule.enabled) return false;
    if (!schedule.lastRun) return true;

    const elapsedHours = (Date.now() - new Date(schedule.lastRun).getTime()) / 3_600_000;
    return schedule.type === 'daily' ? elapsedHours >= 24 : elapsedHours >= 168;
}
