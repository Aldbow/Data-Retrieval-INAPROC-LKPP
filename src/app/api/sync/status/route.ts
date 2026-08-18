/**
 * Sync Status API
 *
 * Reports what is on disk for every endpoint the app knows about, including
 * which of the three formats exist.
 */

import { NextResponse } from 'next/server';
import {
    getAllSyncStates,
    getScheduleConfig,
    getSyncState,
    resetSyncState,
    NO_YEAR,
} from '@/lib/sync-state';
import { getDatasetInfo, type DatasetInfo } from '@/lib/storage-service';
import { DATA_ROOT, KODE_KLPD } from '@/lib/drive-config';
import { getEndpoint, getEndpointTree, ENDPOINTS } from '@/lib/endpoint-registry';

export const dynamic = 'force-dynamic';

interface YearStatus {
    year: string;
    lastSyncDate: string;
    totalRecords: number;
    incomplete: boolean;
    formats: DatasetInfo['formats'];
    derivedStale: boolean;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpointParam = searchParams.get('endpoint');
    const yearParam = searchParams.get('year');
    // Verification clears state whose files have been deleted. It costs a stat
    // per dataset, so polling callers can turn it off.
    const verify = searchParams.get('verify') !== 'false';

    try {
        if (endpointParam) {
            const def = getEndpoint(endpointParam);
            if (!def) {
                return NextResponse.json({ error: 'Unknown endpoint' }, { status: 400 });
            }

            const year = def.yearScoped ? yearParam ?? undefined : undefined;
            const info = await getDatasetInfo(endpointParam, year);
            const state = await getSyncState(endpointParam, year ?? NO_YEAR);

            if (verify && state?.totalRecords && !info.exists) {
                await resetSyncState(endpointParam, year ?? NO_YEAR);
                return NextResponse.json({ endpoint: endpointParam, year, state: null, info });
            }

            return NextResponse.json({ endpoint: endpointParam, year, state, info });
        }

        const allStates = await getAllSyncStates();
        const schedule = await getScheduleConfig();

        const endpoints = await Promise.all(
            ENDPOINTS.map(async (ep) => {
                const recorded = allStates[ep.value] ?? {};

                const years = await Promise.all(
                    Object.entries(recorded).map(async ([year, state]): Promise<YearStatus | null> => {
                        const lookupYear = year === NO_YEAR ? undefined : year;
                        const info = await getDatasetInfo(ep.value, lookupYear);

                        // State without files is stale; drop it so the UI does
                        // not offer a resume that cannot work.
                        if (verify && state.totalRecords > 0 && !info.exists) {
                            await resetSyncState(ep.value, year);
                            return null;
                        }

                        return {
                            year,
                            lastSyncDate: state.lastSyncDate,
                            totalRecords: info.exists ? info.rowCount || state.totalRecords : 0,
                            incomplete: state.incomplete ?? false,
                            formats: info.formats,
                            derivedStale: info.derivedStale,
                        };
                    }),
                );

                const valid = years.filter((y): y is YearStatus => y !== null);

                return {
                    endpoint: ep.value,
                    label: ep.label,
                    generation: ep.generation,
                    group: ep.group,
                    category: ep.category,
                    kind: ep.kind,
                    status: ep.status,
                    yearScoped: ep.yearScoped,
                    years: valid,
                    lastSynced: valid.reduce<string | null>(
                        (latest, y) => (!latest || y.lastSyncDate > latest ? y.lastSyncDate : latest),
                        null,
                    ),
                };
            }),
        );

        return NextResponse.json({
            endpoints,
            tree: getEndpointTree().map(({ title, group, generation, categories, count }) => ({
                title,
                group,
                generation,
                count,
                categories: categories.map((c) => ({ name: c.name, count: c.endpoints.length })),
            })),
            schedule,
            basePath: DATA_ROOT,
            kodeKlpd: KODE_KLPD,
        });
    } catch (error) {
        console.error('[sync/status] failed:', error);
        return NextResponse.json({ error: 'Gagal membaca status sinkronisasi' }, { status: 500 });
    }
}
