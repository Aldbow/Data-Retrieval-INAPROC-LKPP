/**
 * Schedule API
 *
 * Stores the sync schedule preference.
 *
 * Note: nothing executes on this schedule yet. Running syncs on a timer needs a
 * process that outlives a request, which a Next.js route handler is not, so the
 * scheduling UI stays hidden until that exists. Keeping the config endpoint
 * means the setting survives until then.
 */

import { NextResponse } from 'next/server';
import { getScheduleConfig, updateScheduleConfig, isScheduledSyncDue } from '@/lib/sync-state';
import { isKnownEndpoint } from '@/lib/endpoint-registry';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const [schedule, isDue] = await Promise.all([getScheduleConfig(), isScheduledSyncDue()]);
        return NextResponse.json({ schedule, isDue, executorAvailable: false });
    } catch (error) {
        console.error('[schedule] read failed:', error);
        return NextResponse.json({ error: 'Gagal membaca konfigurasi jadwal' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const updates: Parameters<typeof updateScheduleConfig>[0] = {};

        if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
        if (body.type === 'daily' || body.type === 'weekly') updates.type = body.type;

        if (Array.isArray(body.endpoints)) {
            updates.endpoints = body.endpoints.filter(
                (ep: unknown): ep is string => typeof ep === 'string' && isKnownEndpoint(ep),
            );
        }

        await updateScheduleConfig(updates);
        return NextResponse.json({ success: true, schedule: await getScheduleConfig() });
    } catch (error) {
        console.error('[schedule] update failed:', error);
        return NextResponse.json({ error: 'Gagal memperbarui jadwal' }, { status: 500 });
    }
}

/** Records that a scheduled run happened. */
export async function PUT() {
    try {
        await updateScheduleConfig({ lastRun: new Date().toISOString() });
        return NextResponse.json({ success: true, schedule: await getScheduleConfig() });
    } catch (error) {
        console.error('[schedule] mark-run failed:', error);
        return NextResponse.json({ error: 'Gagal menandai jadwal' }, { status: 500 });
    }
}
