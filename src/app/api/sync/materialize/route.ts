/**
 * Materialize API
 *
 * Regenerates the .csv and .xlsx copies from the canonical .json.
 *
 * Needed because the derived formats are written when a sync completes; if a
 * sync was interrupted, or a derived file was deleted or edited by hand, this
 * brings all three back into agreement without re-fetching from the API.
 */

import { NextResponse } from 'next/server';
import { getEndpoint } from '@/lib/endpoint-registry';
import { isValidYear, UnsafePathError } from '@/lib/drive-config';
import { getDatasetInfo, materializeDerived } from '@/lib/storage-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
    }

    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const def = getEndpoint(endpoint);

    if (!def) {
        return NextResponse.json({ error: 'Unknown endpoint' }, { status: 400 });
    }

    let year: string | undefined;
    if (def.yearScoped) {
        if (!isValidYear(body.year)) {
            return NextResponse.json({ error: 'Tahun tidak valid' }, { status: 400 });
        }
        year = body.year;
    }

    try {
        const info = await getDatasetInfo(endpoint, year);
        if (!info.exists) {
            return NextResponse.json(
                { error: 'Belum ada data JSON kanonik untuk endpoint dan tahun ini' },
                { status: 404 },
            );
        }

        const result = await materializeDerived(endpoint, year);

        return NextResponse.json({
            success: true,
            endpoint,
            year: year ?? null,
            rowCount: result.rowCount,
            files: { csv: result.csv, xlsx: result.xlsx },
        });
    } catch (error) {
        if (error instanceof UnsafePathError) {
            return NextResponse.json({ error: 'Endpoint atau tahun tidak valid' }, { status: 400 });
        }
        console.error(`[materialize] ${endpoint} failed:`, error);
        return NextResponse.json({ error: 'Gagal membuat ulang file CSV/XLSX' }, { status: 500 });
    }
}
