/**
 * Pull v1 (all)
 *
 * Standalone one-shot puller for every `/v1/*` endpoint, run outside the UI.
 * Reuses the exact fetch/pagination/dedup/storage logic behind `/api/sync`
 * (src/app/api/sync/route.ts) but drives it in a plain loop instead of
 * round-tripping through HTTP once per page batch -- there is no browser
 * request to keep under a timeout here, so each endpoint runs to completion
 * in one call instead of requiring the client to re-invoke the route.
 *
 * `sync-state.json` is locked with an in-process promise queue only (see
 * sync-state.ts), not a cross-process file lock -- do not run this at the
 * same time as a manual sync from the UI against the same DATA_ROOT.
 *
 * Usage:
 *   npm run pull:v1 -- --year 2024
 *   npm run pull:v1 -- --year 2024 --fresh
 *   npm run pull:v1 -- --year 2024 --endpoint /v1/rup/master-satker
 */

import { ENDPOINTS, type EndpointDef } from '../src/lib/endpoint-registry.ts';
import { fetchPage, ApiError } from '../src/lib/inaproc-client.ts';
import {
    appendRecords,
    appendSnapshot,
    overwriteRecords,
    materializeDerived,
    getDatasetInfo,
    deleteDataset,
    type WriteResult,
} from '../src/lib/storage-service.ts';
import { getSyncState, updateSyncState, NO_YEAR } from '../src/lib/sync-state.ts';
import { isValidYear } from '../src/lib/drive-config.ts';
import type { DataRecord } from '../src/lib/response-adapter.ts';

const BATCH_SIZE = 100;
/** Courtesy pause between upstream pages -- matches route.ts's INTER_PAGE_DELAY_MS. */
const INTER_PAGE_DELAY_MS = 200;
/** Small pause between endpoints, on top of the per-page delay. */
const INTER_ENDPOINT_DELAY_MS = 300;
/**
 * Safety valve only -- unlike route.ts's maxPages (there to keep one HTTP
 * request short), this exists purely so a broken upstream loop can't hang
 * the process forever.
 */
const MAX_PAGES_SAFETY_VALVE = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Args {
    year: string;
    fresh: boolean;
    endpoint: string | null;
}

function parseArgs(argv: string[]): Args {
    let year: string | null = null;
    let fresh = false;
    let endpoint: string | null = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--year') {
            year = argv[++i] ?? null;
        } else if (arg === '--fresh') {
            fresh = true;
        } else if (arg === '--endpoint') {
            endpoint = argv[++i] ?? null;
        }
    }

    if (!year || !isValidYear(year)) {
        console.error(
            'Usage: npm run pull:v1 -- --year <YYYY> [--fresh] [--endpoint </v1/...>]\n' +
            `Got --year=${year ?? '(missing)'}, expected four digits between 2000 and 2100.`,
        );
        process.exit(1);
    }

    return { year, fresh, endpoint };
}

interface EndpointOutcome {
    endpoint: string;
    status: 'complete' | 'incomplete' | 'failed';
    pagesFetched: number;
    newRecords: number;
    duplicatesSkipped: number;
    totalRecords: number;
    error?: string;
}

async function pullEndpoint(def: EndpointDef, requestedYear: string, fresh: boolean): Promise<EndpointOutcome> {
    const year = def.yearScoped ? requestedYear : undefined;
    const stateKey = year ?? NO_YEAR;

    if (fresh) {
        await deleteDataset(def.value, year);
        await updateSyncState(def.value, stateKey, { lastCursor: null, lastOffset: 0, totalRecords: 0 });
    }

    const previous = fresh ? null : await getSyncState(def.value, stateKey);
    const info = await getDatasetInfo(def.value, year);

    // A resume point is only usable if the data it points into is still on disk.
    const resumable = info.exists ? previous : null;
    let cursor: string | null = resumable?.lastCursor ?? null;
    let offset = resumable?.lastOffset ?? 0;

    const snapshotAt = def.group === 'dashboard' ? new Date().toISOString() : undefined;
    const collected: DataRecord[] = [];
    let pagesFetched = 0;
    let isComplete = false;

    while (pagesFetched < MAX_PAGES_SAFETY_VALVE) {
        const page = await fetchPage(def.value, {
            year,
            cursor,
            offset,
            limit: def.pagination === 'none' ? undefined : BATCH_SIZE,
            snapshotAt,
        });

        if (page.apiError) {
            return {
                endpoint: def.value,
                status: 'failed',
                pagesFetched,
                newRecords: 0,
                duplicatesSkipped: 0,
                totalRecords: info.rowCount,
                error: `API menolak permintaan (${page.apiError.code}): ${page.apiError.message}`,
            };
        }

        if (page.rows.length === 0) {
            isComplete = true;
            break;
        }

        collected.push(...page.rows);
        pagesFetched++;

        if (def.pagination === 'offset') {
            offset += page.rows.length;
            if (page.rows.length < BATCH_SIZE) {
                isComplete = true;
                break;
            }
        } else {
            cursor = page.cursor;
            if (!page.hasMore) {
                isComplete = true;
                break;
            }
        }

        await sleep(INTER_PAGE_DELAY_MS);
    }

    let write: WriteResult | null = null;

    if (collected.length > 0) {
        if (def.kind === 'aggregate') {
            write = await appendSnapshot(def.value, year, collected);
        } else if (def.pagination === 'none' && isComplete) {
            write = await overwriteRecords(def.value, year, collected, def.uniqueKeys);
        } else {
            write = await appendRecords(def.value, year, collected, def.uniqueKeys);
        }

        await updateSyncState(def.value, stateKey, {
            lastCursor: isComplete ? null : cursor,
            lastOffset: isComplete ? 0 : offset,
            totalRecords: write.totalRecords,
            incomplete: !isComplete,
        });
    }

    const shouldMaterialize = isComplete && (write !== null || info.derivedStale);
    if (shouldMaterialize) {
        await materializeDerived(def.value, year);
    }

    return {
        endpoint: def.value,
        status: isComplete ? 'complete' : 'incomplete',
        pagesFetched,
        newRecords: write?.newRecords ?? 0,
        duplicatesSkipped: write?.duplicatesSkipped ?? 0,
        totalRecords: write?.totalRecords ?? info.rowCount,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!process.env.JWT_TOKEN) {
        console.error('JWT_TOKEN is not configured (check .env.local). Aborting before any requests.');
        process.exit(1);
    }

    let targets = ENDPOINTS.filter((ep) => ep.generation === 'v1' && ep.status === 'ready');

    if (args.endpoint) {
        targets = targets.filter((ep) => ep.value === args.endpoint);
        if (targets.length === 0) {
            console.error(`--endpoint ${args.endpoint} is not a ready v1 endpoint. Check src/lib/endpoint-registry.ts.`);
            process.exit(1);
        }
    }

    console.log(
        `Pulling ${targets.length} v1 endpoint(s) for year ${args.year}` +
        `${args.fresh ? ' (fresh)' : ' (resume)'}...\n`,
    );

    const outcomes: EndpointOutcome[] = [];

    for (const [index, def] of targets.entries()) {
        const label = def.yearScoped ? `${def.value} (${args.year})` : def.value;
        process.stdout.write(`[${index + 1}/${targets.length}] ${label} ... `);

        try {
            const outcome = await pullEndpoint(def, args.year, args.fresh);
            outcomes.push(outcome);

            if (outcome.status === 'failed') {
                console.log(`FAILED -- ${outcome.error}`);
            } else {
                console.log(
                    `${outcome.status} -- ${outcome.pagesFetched} page(s), ` +
                    `+${outcome.newRecords} new, ${outcome.duplicatesSkipped} dup skipped, ` +
                    `${outcome.totalRecords} total`,
                );
            }
        } catch (error) {
            const message = error instanceof ApiError
                ? `${error.message} (status ${error.status})`
                : error instanceof Error ? error.message : String(error);
            console.log(`FAILED -- ${message}`);
            outcomes.push({
                endpoint: def.value,
                status: 'failed',
                pagesFetched: 0,
                newRecords: 0,
                duplicatesSkipped: 0,
                totalRecords: 0,
                error: message,
            });
        }

        if (index < targets.length - 1) {
            await sleep(INTER_ENDPOINT_DELAY_MS);
        }
    }

    const failed = outcomes.filter((o) => o.status === 'failed');
    const incomplete = outcomes.filter((o) => o.status === 'incomplete');
    const totalNewRecords = outcomes.reduce((sum, o) => sum + o.newRecords, 0);

    console.log('\n--- Summary ---');
    console.log(`Endpoints processed : ${outcomes.length}`);
    console.log(`Complete            : ${outcomes.length - failed.length - incomplete.length}`);
    console.log(`Incomplete          : ${incomplete.length}`);
    console.log(`Failed              : ${failed.length}`);
    console.log(`New records total   : ${totalNewRecords}`);

    if (incomplete.length > 0) {
        console.log('\nIncomplete (hit the safety valve -- re-run to resume):');
        for (const o of incomplete) console.log(`  - ${o.endpoint}`);
    }

    if (failed.length > 0) {
        console.log('\nFailed:');
        for (const o of failed) console.log(`  - ${o.endpoint}: ${o.error}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
