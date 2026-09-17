/**
 * Browse API
 *
 * Read-only proxy the Browser tab pages through. One handler serves every
 * endpoint -- the per-endpoint routes that used to exist were byte-identical
 * copies of this one with the path hardcoded.
 */

import { NextResponse } from 'next/server';
import { getEndpoint } from '@/lib/endpoint-registry';
import { isValidYear } from '@/lib/drive-config';
import { fetchPage, ApiError } from '@/lib/inaproc-client';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') ?? '';
    const yearParam = searchParams.get('year');
    const cursor = searchParams.get('cursor');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, MAX_LIMIT);

    const def = getEndpoint(endpoint);
    if (!def) {
        return NextResponse.json({ error: 'Unknown endpoint' }, { status: 400 });
    }

    if (def.status !== 'ready') {
        return NextResponse.json(
            {
                error:
                    def.status === 'requires-id'
                        ? 'Endpoint ini membutuhkan ID spesifik'
                        : def.status === 'unavailable'
                            ? 'Endpoint ini tidak tersedia di API (HTTP 404)'
                            : 'Endpoint ini membutuhkan parameter yang belum diketahui',
                data: [],
                has_more: false,
            },
            { status: 400 },
        );
    }

    let year: string | undefined;
    if (def.yearScoped) {
        if (!isValidYear(yearParam)) {
            return NextResponse.json({ error: 'Tahun tidak valid' }, { status: 400 });
        }
        year = yearParam;
    }

    try {
        const page = await fetchPage(endpoint, { year, cursor, limit });

        if (page.apiError) {
            return NextResponse.json(
                { error: page.apiError.message, code: page.apiError.code, data: [], has_more: false },
                { status: 400 },
            );
        }

        return NextResponse.json({
            data: page.rows,
            cursor: page.cursor,
            has_more: page.hasMore,
            meta: { count: page.rows.length, shape: page.detectedShape },
        });
    } catch (error) {
        // Upstream text is logged but not returned, so API internals stay server-side.
        console.error(`[inaproc] ${endpoint} failed:`, error);
        const status = error instanceof ApiError && error.status === 500 ? 500 : 502;
        return NextResponse.json({ error: 'Gagal mengambil data dari API INAPROC' }, { status });
    }
}
