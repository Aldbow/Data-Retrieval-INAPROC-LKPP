import { NextResponse } from 'next/server';
import { getSyncableEndpoints } from '@/lib/constants';

// Set maximum duration for Vercel Serverless Function (requires Pro for > 60s, Hobby max 10s)
// Kami set ke maksimal untuk memastikan cron punya waktu cukup untuk memicu sync
export const maxDuration = 300; 
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    
    // Verifikasi Vercel Cron Secret
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    const year = String(new Date().getFullYear());
    const endpoints = getSyncableEndpoints().map(ep => ep.value);

    // Karena Vercel bisa timeout jika kita menuangkan semua tugas sinkronisasi sekaligus,
    // kita memicu endpoint /api/sync secara tidak serempak tapi membiarkan mereka berjalan di background
    // secara internal jika server mendukungnya. 
    // Pendekatan terbaik untuk Cron Vercel adalah menjalankan beberapa fetch secara bersamaan namun terbatas.
    
    console.log(`[CRON] Starting Daily Sync for Year ${year}`);

    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;

    try {
        // Ambil 5 endpoint terpenting dulu agar tidak membebani server/timeout
        const priorityEndpoints = endpoints.slice(0, 5);

        for (const ep of priorityEndpoints) {
            console.log(`[CRON] Triggering sync for ${ep}`);
            // Kita tidak await fetch ini agar function tidak keburu timeout. 
            // Kita biarkan Node.js memprosesnya di latar belakang.
            // CATATAN: Di Vercel Serverless, eksekusi latar belakang mungkin dihentikan saat respon dikirim.
            // Solusi: Kita tunggu (await) tapi batasi maxPages agar cepat selesai.
            
            await fetch(`${baseUrl}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: ep,
                    year: year,
                    batchSize: 100,
                    maxPages: 20 // Batasi 20 halaman saja per endpoint saat Cron berjalan agar tidak timeout
                })
            }).catch(e => console.error(`Failed to trigger ${ep}`, e));
        }

        return NextResponse.json({ 
            success: true, 
            message: `Cron executed for ${priorityEndpoints.length} endpoints`, 
            year 
        });
    } catch (error: any) {
        console.error('[CRON] Error executing daily sync', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
