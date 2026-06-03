import { NextResponse } from 'next/server';
import { getFileInfo } from '@/lib/excel-service';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');
    const year = searchParams.get('year');
    const limit = parseInt(searchParams.get('limit') || '500', 10);
    const cursor = parseInt(searchParams.get('cursor') || '0', 10);
    const search = searchParams.get('search')?.toLowerCase();

    if (!endpoint || !year) {
        return NextResponse.json({ error: 'Missing required params: endpoint, year' }, { status: 400 });
    }

    try {
        const fileInfo = await getFileInfo(endpoint, year, true);

        if (!fileInfo.exists) {
            return NextResponse.json({
                error: 'Data belum tersinkronisasi ke Supabase. Silakan gunakan Sync Manager.',
                local_not_found: true
            }, { status: 404 });
        }

        let total = 0;

        if (search) {
            // Pencarian global dalam JSONB dilakukan di memory
            const { data, error } = await supabase
                .from('inaproc_data')
                .select('data')
                .eq('endpoint', endpoint)
                .eq('year', year);
                
            if (error) throw error;
            
            const rawRecords = data.map(d => d.data);
            const filtered = rawRecords.filter(record => {
                for (const key in record) {
                    if (record[key] !== null && record[key] !== undefined) {
                        if (String(record[key]).toLowerCase().includes(search)) return true;
                    }
                }
                return false;
            });
            
            total = filtered.length;
            const pageData = filtered.slice(cursor, cursor + limit);
            const nextCursor = cursor + limit;
            const hasMore = nextCursor < total;
            
            return NextResponse.json({
                data: pageData,
                meta: { total },
                has_more: hasMore,
                cursor: hasMore ? String(nextCursor) : null
            });
        }
        
        // Tanpa pencarian, paginasi langsung dari Supabase
        const { data, count, error } = await supabase
            .from('inaproc_data')
            .select('data', { count: 'exact' })
            .eq('endpoint', endpoint)
            .eq('year', year)
            .range(cursor, cursor + limit - 1);
            
        if (error) throw error;
        
        const pageData = data.map(d => d.data);
        total = count || 0;
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
