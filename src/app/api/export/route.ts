/**
 * Export API
 *
 * Serves a dataset as json, csv or xlsx. Local files are preferred: the whole
 * point of syncing is to avoid re-pulling data that is already on disk, and a
 * local read is not subject to the upstream page cap.
 *
 * Falls back to fetching from the API for endpoints that have never been
 * synced. That path is capped, and says so via `X-Export-Truncated` instead of
 * silently returning a short file.
 */

import { NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as XLSX from 'xlsx';
import { getEndpoint } from '@/lib/endpoint-registry';
import { isValidYear, getDatasetPaths, type StorageFormat, STORAGE_FORMATS } from '@/lib/drive-config';
import { readCanonical, toCsv, toWorkbook } from '@/lib/storage-service';
import { fetchPage, ApiError } from '@/lib/inaproc-client';
import type { DataRecord } from '@/lib/response-adapter';

export const dynamic = 'force-dynamic';

/** Cap for the live-fetch fallback. Reported to the caller when hit. */
const MAX_LIVE_PAGES = 200;
const LIVE_PAGE_SIZE = 100;

const CONTENT_TYPES: Record<StorageFormat, string> = {
    json: 'application/json; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function isStorageFormat(value: string): value is StorageFormat {
    return (STORAGE_FORMATS as readonly string[]).includes(value);
}

/** Case-insensitive match across every value in the record. */
function matchesSearch(record: DataRecord, needle: string): boolean {
    for (const value of Object.values(record)) {
        if (value === null || value === undefined) continue;
        if (String(value).toLowerCase().includes(needle)) return true;
    }
    return false;
}

function serialize(records: DataRecord[], format: StorageFormat, sheetLabel: string): Buffer | string {
    if (format === 'json') return JSON.stringify(records, null, 2);
    if (format === 'csv') return toCsv(records);
    return XLSX.write(toWorkbook(records, sheetLabel), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') ?? '';
    const yearParam = searchParams.get('year');
    const search = (searchParams.get('search') ?? '').trim().toLowerCase();
    const formatParam = searchParams.get('format') ?? 'xlsx';

    if (!isStorageFormat(formatParam)) {
        return NextResponse.json({ error: 'Format harus json, csv, atau xlsx' }, { status: 400 });
    }
    const format: StorageFormat = formatParam;

    const def = getEndpoint(endpoint);
    if (!def) {
        return NextResponse.json({ error: 'Unknown endpoint' }, { status: 400 });
    }

    let year: string | undefined;
    if (def.yearScoped) {
        if (!isValidYear(yearParam)) {
            return NextResponse.json({ error: 'Tahun tidak valid' }, { status: 400 });
        }
        year = yearParam;
    }

    const name = endpoint.split('/').filter(Boolean).pop() ?? 'export';
    const filename = `INAPROC_${name}${year ? `_${year}` : ''}_${new Date().toISOString().slice(0, 10)}.${format}`;
    const sheetLabel = year ? `Data ${year}` : 'Data';

    try {
        const paths = getDatasetPaths(endpoint, year);
        const localExists = await fs
            .stat(paths.json)
            .then(() => true)
            .catch(() => false);

        let records: DataRecord[];
        let source: 'local' | 'api';
        let truncated = false;

        if (localExists) {
            records = await readCanonical(endpoint, year);
            source = 'local';

            // Serve the stored file verbatim when no filtering is needed and
            // the requested format is already materialised on disk.
            if (!search) {
                const stored = await fs.readFile(paths[format]).catch(() => null);
                if (stored) {
                    return new NextResponse(new Uint8Array(stored), {
                        headers: {
                            'Content-Type': CONTENT_TYPES[format],
                            'Content-Disposition': `attachment; filename="${filename}"`,
                            'X-Export-Source': 'local',
                            'X-Export-Rows': String(records.length),
                        },
                    });
                }
            }
        } else {
            if (def.status !== 'ready') {
                return NextResponse.json(
                    { error: 'Endpoint ini belum bisa diambil dan belum pernah disinkronkan' },
                    { status: 400 },
                );
            }

            records = [];
            source = 'api';
            let cursor: string | null = null;

            for (let page = 0; page < MAX_LIVE_PAGES; page++) {
                const result = await fetchPage(endpoint, {
                    year,
                    cursor,
                    limit: def.paginated ? LIVE_PAGE_SIZE : undefined,
                });

                if (result.apiError || result.rows.length === 0) break;

                records.push(...result.rows);
                cursor = result.cursor;

                if (!result.hasMore) break;
                if (page === MAX_LIVE_PAGES - 1) truncated = true;
            }
        }

        const filtered = search ? records.filter((r) => matchesSearch(r, search)) : records;
        const payload = serialize(filtered, format, sheetLabel);
        const body = typeof payload === 'string' ? payload : new Uint8Array(payload);

        return new NextResponse(body, {
            headers: {
                'Content-Type': CONTENT_TYPES[format],
                'Content-Disposition': `attachment; filename="${filename}"`,
                'X-Export-Source': source,
                'X-Export-Rows': String(filtered.length),
                'X-Export-Truncated': String(truncated),
            },
        });
    } catch (error) {
        console.error(`[export] ${endpoint} failed:`, error);
        const status = error instanceof ApiError && error.status === 500 ? 500 : 502;
        return NextResponse.json({ error: 'Gagal membuat file ekspor' }, { status });
    }
}
