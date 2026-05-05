/**
 * Sync Status API Route
 * Returns the sync status for all endpoints or a specific endpoint
 * Also verifies file existence and updates state if files are missing
 */

import { NextResponse } from 'next/server';
import { getAllSyncStates, getScheduleConfig, getSyncState, updateSyncState, resetSyncState } from '@/lib/sync-state';
import { getFileInfo } from '@/lib/excel-service';
import { ENDPOINTS } from '@/lib/constants';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');
    const year = searchParams.get('year');
    const verifyFiles = searchParams.get('verify') !== 'false'; // Default to true

    try {
        // If specific endpoint requested
        if (endpoint && year) {
            const state = await getSyncState(endpoint, year);
            const fileInfo = await getFileInfo(endpoint, year);
            const schedule = await getScheduleConfig();

            // If state says we have records but file doesn't exist, reset state
            if (verifyFiles && state?.totalRecords && !fileInfo.exists) {
                console.log(`File missing for ${endpoint} ${year}, resetting state`);
                await resetSyncState(endpoint, year);
                return NextResponse.json({
                    endpoint,
                    year,
                    state: null,
                    fileInfo,
                    schedule,
                });
            }

            return NextResponse.json({
                endpoint,
                year,
                state,
                fileInfo,
                schedule,
            });
        }

        // Return all states with file verification
        const allStates = await getAllSyncStates();
        const schedule = await getScheduleConfig();

        // Build comprehensive status for all endpoints with file verification
        const endpointStatusesPromises = ENDPOINTS.map(async (ep) => {
            const endpointStates = allStates[ep.value] || {};
            const years = Object.keys(endpointStates);

            // Verify files for each year and update state if needed
            const verifiedYears = await Promise.all(
                years.map(async (y) => {
                    const state = endpointStates[y];
                    const fileInfo = await getFileInfo(ep.value, y);

                    // If file doesn't exist but state has records, reset
                    if (verifyFiles && state?.totalRecords && !fileInfo.exists) {
                        console.log(`File missing for ${ep.value} ${y}, clearing from status`);
                        await resetSyncState(ep.value, y);
                        return null; // Will be filtered out
                    }

                    return {
                        year: y,
                        state: {
                            ...state,
                            // In fastMode, getFileInfo doesn't return recordCount to save memory. Use state.
                            totalRecords: fileInfo.exists ? (state?.totalRecords || 0) : 0,
                        },
                        fileExists: fileInfo.exists,
                    };
                })
            );

            // Filter out null entries (deleted files)
            const validYears = verifiedYears.filter((y) => y !== null);

            return {
                endpoint: ep.value,
                label: ep.label,
                years: validYears,
                lastSynced: validYears.length > 0
                    ? validYears.reduce((latest, item) => {
                        if (!item) return latest;
                        const stateDate = new Date(item.state.lastSyncDate);
                        return stateDate > latest ? stateDate : latest;
                    }, new Date(0))
                    : null,
            };
        });

        const endpointStatuses = await Promise.all(endpointStatusesPromises);

        console.log('Refresh complete - verified all file states');

        return NextResponse.json({
            endpoints: endpointStatuses,
            schedule,
            basePath: process.env.SYNC_LOCATION || process.env.INAPROC_DATA_PATH || 'C:/Users/User/Documents/Aldiva/01 - DATABASE INAPROC LKPP',
        });
    } catch (error: any) {
        console.error('Error getting sync status:', error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

