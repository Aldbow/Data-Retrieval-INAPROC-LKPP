/**
 * Local Browse API
 *
 * Serves rows already on disk, paginated the same way /api/inaproc paginates
 * live rows, so the Browser tab can switch source without changing shape.
 *
 * Offsets stand in for cursors here: the canonical file is a plain array, so
 * the position in it is the only resume token there is.
 */

import { NextResponse } from 'next/server';
import { getEndpoint } from '@/lib/endpoint-registry';
import { isValidYear, UnsafePathError } from '@/lib/drive-config';
import { getDatasetInfo, readCanonical } from '@/lib/storage-service';
import type { DataRecord } from '@/lib/response-adapter';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;

/** Case-insensitive match against any value in the record. */
function matches(record: DataRecord, needle: string): boolean {
    for (const value of Object.values(record)) {
        if (value === null || value === undefined) continue;
        if (String(value).toLowerCase().includes(needle)) return true;
    }
    return false;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') ?? '';
    const yearParam = searchParams.get('year');
    const search = searchParams.get('search')?.toLowerCase();
    const limit = Math.min(Number(searchParams.get('limit')) || 50, MAX_LIMIT);

    // The cursor is an index into the stored array, not an upstream token.
    const offset = Math.max(Number(searchParams.get('cursor')) || 0, 0);

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

    try {
        const info = await getDatasetInfo(endpoint, year);

        if (!info.exists) {
            return NextResponse.json(
                {
                    error: 'Data lokal belum tersedia. Lakukan sinkronisasi di tab Sync Manager terlebih dahulu.',
                    local_not_found: true,
                    data: [],
                    has_more: false,
                },
                { status: 404 },
            );
        }

        const records = await readCanonical(endpoint, year);
        const filtered = search ? records.filter((r) => matches(r, search)) : records;

        const page = filtered.slice(offset, offset + limit);
        const next = offset + page.length;
        const hasMore = next < filtered.length;

        return NextResponse.json({
            data: page,
            meta: { total: filtered.length },
            has_more: hasMore,
            cursor: hasMore ? String(next) : null,
        });
    } catch (error) {
        if (error instanceof UnsafePathError) {
            return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 });
        }

        console.error(`[local] ${endpoint}:`, error);
        return NextResponse.json({ error: 'Gagal membaca data lokal' }, { status: 500 });
    }
}
