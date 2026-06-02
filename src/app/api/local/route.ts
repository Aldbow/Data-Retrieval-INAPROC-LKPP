import { NextResponse } from 'next/server';
import { loadExistingRecords, getFileInfo } from '@/lib/excel-service';
import { getFilePath } from '@/lib/drive-config';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');
    const year = searchParams.get('year');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const cursor = parseInt(searchParams.get('cursor') || '0', 10); // using array index as cursor
    const search = searchParams.get('search')?.toLowerCase();

    if (!endpoint || !year) {
        return NextResponse.json({ error: 'Missing required params: endpoint, year' }, { status: 400 });
    }

    try {
        const fileInfo = await getFileInfo(endpoint, year, true);

        if (!fileInfo.exists) {
            return NextResponse.json({
                error: 'Data lokal belum tersedia. Silakan lakukan Sinkronisasi di tab Sync Manager terlebih dahulu.',
                local_not_found: true
            }, { status: 404 });
        }

        const filePath = getFilePath(endpoint, year);
        const { records } = await loadExistingRecords(filePath);

        let filteredRecords = records;

        // Apply search filter if provided
        if (search) {
            filteredRecords = records.filter(record => {
                // Check if any property value matches the search string
                for (const key in record) {
                    const val = record[key];
                    if (val !== null && val !== undefined) {
                        if (String(val).toLowerCase().includes(search)) {
                            return true;
                        }
                    }
                }
                return false;
            });
        }

        // Apply pagination
        const total = filteredRecords.length;
        const pageData = filteredRecords.slice(cursor, cursor + limit);
        const nextCursor = cursor + limit;
        const hasMore = nextCursor < total;

        return NextResponse.json({
            data: pageData,
            meta: { total },
            has_more: hasMore,
            cursor: hasMore ? String(nextCursor) : null
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
