import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const BASE_URL = 'https://data.inaproc.id/api';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || '/v1/ekatalog-archive/paket-e-purchasing';
    const year = searchParams.get('year') || '2024';
    const search = searchParams.get('search');
    const JWT_TOKEN = process.env.JWT_TOKEN;

    if (!JWT_TOKEN) {
        return NextResponse.json({ error: 'JWT_TOKEN not configured' }, { status: 500 });
    }

    if (!endpoint.startsWith('/v1/') && !endpoint.startsWith('/legacy/')) {
        return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    try {
        let allExportData: any[] = [];
        let currentCursor: string | null = null;
        let keepFetching = true;
        let pageCount = 0;

        const baseQuery = new URLSearchParams({
            tahun: year,
            limit: '100',
            kode_klpd: 'K34'
        });

        // The live API might accept search? We'll pass it if it exists.
        // Wait, the frontend passed it to our proxy, did our proxy pass it?
        // Inaproc API doesn't seem to natively support generic 'search' on all endpoints, but we will pass it if needed.

        while (keepFetching) {
            let apiUrl = `${BASE_URL}${endpoint}?${baseQuery.toString()}`;
            if (currentCursor) {
                apiUrl += `&cursor=${encodeURIComponent(currentCursor)}`;
            }

            const res = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${JWT_TOKEN}`,
                    'Accept': 'application/json',
                },
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`API Error: ${res.status} - ${errorText}`);
            }

            const result = await res.json();
            
            // Handle Legacy array format
            if (Array.isArray(result)) {
                allExportData = result;
                keepFetching = false;
                break;
            }

            const pageData = result.data || [];

            if (pageData.length === 0) {
                keepFetching = false;
            } else {
                allExportData = [...allExportData, ...pageData];
                const nextCursor = result.cursor || (result.meta && result.meta.cursor);
                if (nextCursor && result.has_more !== false) {
                    currentCursor = nextCursor;
                } else {
                    keepFetching = false;
                }
            }

            // Safety limit (e.g., max 20,000 rows, or 200 pages) to prevent server OOM
            if (pageCount >= 200) break;
            pageCount++;
        }

        const worksheet = XLSX.utils.json_to_sheet(allExportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `Data ${year}`);
        
        // Write to buffer
        const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        return new NextResponse(buf, {
            status: 200,
            headers: {
                'Content-Disposition': `attachment; filename="INAPROC_Data_${year}.xlsx"`,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
        });

    } catch (error: any) {
        console.error("Export generation failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
