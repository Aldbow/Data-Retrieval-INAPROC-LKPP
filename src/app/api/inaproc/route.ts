
import { NextResponse } from 'next/server';

const BASE_URL = 'https://data.inaproc.id/api';
const JWT_TOKEN = process.env.JWT_TOKEN;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || '/v1/ekatalog-archive/paket-e-purchasing';
    const year = searchParams.get('year') || '2024';
    const limit = searchParams.get('limit') || '50';
    const cursor = searchParams.get('cursor');

    if (!JWT_TOKEN) {
        return NextResponse.json({ error: 'JWT_TOKEN not configured' }, { status: 500 });
    }

    // Basic security check to ensure it hits the API and not some internal path
    if (!endpoint.startsWith('/v1/') && !endpoint.startsWith('/legacy/')) {
        return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    try {
        let apiUrl = `${BASE_URL}${endpoint}?limit=${limit}&tahun=${year}`;

        // Add kode_klpd for ALL endpoints (both V1 and Legacy require it)
        apiUrl += `&kode_klpd=K34`;

        if (cursor) {
            apiUrl += `&cursor=${encodeURIComponent(cursor)}`;
        }

        const res = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${JWT_TOKEN}`,
                'Accept': 'application/json',
            },
        });

        if (!res.ok) {
            const errorText = await res.text();
            return NextResponse.json({ error: `API Error: ${res.status} - ${errorText}` }, { status: res.status });
        }

        const data = await res.json();

        // Normalize Legacy API response (direct array) to standard format
        if (Array.isArray(data)) {
            return NextResponse.json({
                data: data,
                meta: { total: data.length },
                has_more: false // Legacy typically returns all data at once
            });
        }

        return NextResponse.json(data);

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
