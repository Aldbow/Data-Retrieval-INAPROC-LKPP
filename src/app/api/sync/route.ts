/**
 * Sync API
 *
 * Pulls one slice of an endpoint's data and writes it to the local store in all
 * three formats. The client calls this repeatedly until `isComplete` is true.
 */

import { NextResponse } from 'next/server';
import { getSyncState, updateSyncState, NO_YEAR } from '@/lib/sync-state';
import {
    appendRecords,
    appendSnapshot,
    overwriteRecords,
    materializeDerived,
    getDatasetInfo,
    deleteDataset,
    type WriteResult,
} from '@/lib/storage-service';
import { getDatasetPaths, isValidYear, UnsafePathError } from '@/lib/drive-config';
import { getEndpoint } from '@/lib/endpoint-registry';
import { fetchPage, ApiError } from '@/lib/inaproc-client';
import type { DataRecord } from '@/lib/response-adapter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Pages fetched per request before handing control back to the client. */
const DEFAULT_MAX_PAGES = 10;
const MAX_ALLOWED_PAGES = 100;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;
/** Courtesy pause between upstream pages. */
const INTER_PAGE_DELAY_MS = 200;

interface SyncResponse {
    success: boolean;
    endpoint: string;
    year: string | null;
    newRecords: number;
    duplicatesSkipped: number;
    totalRecords: number;
    pagesFetched: number;
    isComplete: boolean;
    /**
     * True when the request ended without fetching anything and without
     * reaching the end of the data -- the caller must stop rather than retry
     * the identical request. Without this the client's `while (!isComplete)`
     * loop spun forever against a failing upstream.
     */
    stalled: boolean;
    files?: { json: string; csv: string; xlsx: string };
    warning?: string;
}

function badRequest(error: string, hint?: string) {
    return NextResponse.json({ success: false, error, hint }, { status: 400 });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return badRequest('Body must be valid JSON');
    }

    const endpointValue = typeof body.endpoint === 'string' ? body.endpoint : '';
    const rawYear = body.year;
    const forceOverwrite = body.forceOverwrite === true;

    // Whitelist against the registry. A prefix check was not enough: everything
    // after the prefix used to be forwarded to the upstream API verbatim.
    const def = getEndpoint(endpointValue);
    if (!def) {
        return badRequest('Unknown endpoint');
    }

    if (def.status === 'requires-id') {
        return badRequest(
            'This endpoint needs a record identifier and cannot be synced in bulk',
            'Detail endpoints require parameters such as kd_penyedia or kd_komoditas',
        );
    }

    if (def.status === 'needs-params') {
        return badRequest(
            'This endpoint rejects every parameter combination we know',
            'The upstream API returns HTTP 400 until an undocumented required parameter is supplied',
        );
    }

    // Year is only meaningful for year-scoped endpoints, and is rejected unless
    // it is exactly four digits -- it becomes part of a filename.
    let year: string | undefined;
    if (def.yearScoped) {
        if (!isValidYear(rawYear)) {
            return badRequest('Invalid year: expected four digits between 2000 and 2100');
        }
        year = rawYear;
    }

    const stateKey = year ?? NO_YEAR;
    const batchSize = Math.min(Number(body.batchSize) || DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
    const maxPages = Math.min(Number(body.maxPages) || DEFAULT_MAX_PAGES, MAX_ALLOWED_PAGES);

    try {
        if (forceOverwrite) {
            await deleteDataset(endpointValue, year);
            await updateSyncState(endpointValue, stateKey, { lastCursor: null, totalRecords: 0 });
        }

        const previous = forceOverwrite ? null : await getSyncState(endpointValue, stateKey);
        const info = await getDatasetInfo(endpointValue, year);

        // A resume point is only usable if the data it points into is still on disk.
        const resumable = info.exists ? previous : null;
        let cursor: string | null = resumable?.lastCursor ?? null;
        let offset = resumable?.lastOffset ?? 0;

        const snapshotAt = def.group === 'dashboard' ? new Date().toISOString() : undefined;
        const collected: DataRecord[] = [];
        let pagesFetched = 0;
        let isComplete = false;
        let warning: string | undefined;

        while (pagesFetched < maxPages) {
            const page = await fetchPage(endpointValue, {
                year,
                cursor,
                offset,
                limit: def.pagination === 'none' ? undefined : batchSize,
                snapshotAt,
            });

            if (page.apiError) {
                warning = `API menolak permintaan (${page.apiError.code}): ${page.apiError.message}`;
                break;
            }

            if (page.rows.length === 0) {
                // Nothing on this page means we have reached the end.
                isComplete = true;
                break;
            }

            collected.push(...page.rows);
            pagesFetched++;

            // Offset endpoints report no cursor and no has_more, so a short page
            // is the only end-of-data signal they give us.
            if (def.pagination === 'offset') {
                offset += page.rows.length;

                if (page.rows.length < batchSize) {
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
                // Aggregates are observations, not records: keep every capture.
                write = await appendSnapshot(endpointValue, year, collected);
            } else if (def.pagination === 'none' && isComplete) {
                // Unpaginated endpoints return the whole dataset, so replacing
                // it is both correct and cheaper than merging.
                write = await overwriteRecords(endpointValue, year, collected, def.uniqueKeys);
            } else {
                write = await appendRecords(endpointValue, year, collected, def.uniqueKeys);
            }

            await updateSyncState(endpointValue, stateKey, {
                lastCursor: isComplete ? null : cursor,
                lastOffset: isComplete ? 0 : offset,
                totalRecords: write.totalRecords,
                incomplete: !isComplete,
            });
        }

        // Derive csv/xlsx once the dataset is settled rather than per batch.
        const shouldMaterialize = isComplete && (write !== null || info.derivedStale);
        if (shouldMaterialize) {
            await materializeDerived(endpointValue, year);
        }

        const totalRecords = write?.totalRecords ?? info.rowCount;
        const paths = getDatasetPaths(endpointValue, year);

        const response: SyncResponse = {
            success: true,
            endpoint: endpointValue,
            year: year ?? null,
            newRecords: write?.newRecords ?? 0,
            duplicatesSkipped: write?.duplicatesSkipped ?? 0,
            totalRecords,
            pagesFetched,
            isComplete,
            stalled: !isComplete && collected.length === 0,
            files: { json: paths.json, csv: paths.csv, xlsx: paths.xlsx },
            warning,
        };

        return NextResponse.json(response);
    } catch (error) {
        if (error instanceof UnsafePathError) {
            return badRequest('Invalid endpoint or year');
        }

        // Upstream detail goes to the server log only; the client gets a
        // generic message so API internals are not echoed back.
        console.error(`[sync] ${endpointValue} ${year ?? ''} failed:`, error);

        const status = error instanceof ApiError && error.status === 500 ? 500 : 502;
        return NextResponse.json(
            { success: false, error: 'Sync gagal. Periksa log server untuk detail.' },
            { status },
        );
    }
}
