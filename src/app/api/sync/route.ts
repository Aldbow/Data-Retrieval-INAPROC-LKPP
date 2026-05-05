/**
 * Sync API Route
 * Handles incremental data synchronization for INAPROC endpoints
 */

import { NextResponse } from 'next/server';
import { getSyncState, updateSyncState, ensureEndpointFolder } from '@/lib/sync-state';
import { appendToExcel, overwriteExcel, getFileInfo } from '@/lib/excel-service';
import { getFilePath } from '@/lib/drive-config';

const BASE_URL = 'https://data.inaproc.id/api';
const JWT_TOKEN = process.env.JWT_TOKEN;

// Configuration for retries
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    timeout: 30000, // 30 seconds
};

interface SyncResult {
    success: boolean;
    endpoint: string;
    year: string;
    newRecords: number;
    duplicatesSkipped: number;
    totalRecords: number;
    filePath: string;
    isComplete: boolean;
    error?: string;
    verificationStatus?: 'verified' | 'mismatch' | 'unchecked';
}

/**
 * Fetch with retry logic and timeout
 */
async function fetchWithRetry(url: string, options: RequestInit, retryCount = 0): Promise<Response> {
    try {
        // Create controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), RETRY_CONFIG.timeout);

        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Success or non-retriable error
        if (res.ok || res.status === 400 || res.status === 401 || res.status === 404) {
            return res;
        }

        // Retriable status codes (Server errors, Rate limit)
        if ([429, 500, 502, 503, 504].includes(res.status)) {
            throw new Error(`Retriable error: ${res.status}`);
        }

        return res;
    } catch (error: any) {
        if (retryCount >= RETRY_CONFIG.maxRetries) {
            throw error;
        }

        // Calculate backoff delay
        const delay = Math.min(
            RETRY_CONFIG.initialDelay * Math.pow(2, retryCount),
            RETRY_CONFIG.maxDelay
        );

        console.log(`Sync request failed (${error.message}). Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${RETRY_CONFIG.maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retryCount + 1);
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { endpoint, year, batchSize = 100, maxPages = 10 } = body;

        if (!endpoint || !year) {
            return NextResponse.json(
                { error: 'Missing required fields: endpoint, year' },
                { status: 400 }
            );
        }

        if (!JWT_TOKEN) {
            return NextResponse.json(
                { error: 'JWT_TOKEN not configured' },
                { status: 500 }
            );
        }

        // Basic security check - allow both v1 and legacy endpoints
        if (!endpoint.startsWith('/v1/') && !endpoint.startsWith('/legacy/')) {
            return NextResponse.json(
                { error: 'Invalid endpoint' },
                { status: 400 }
            );
        }

        // Block detail endpoints that require specific IDs (like kd_distributor)
        const detailEndpoints = [
            'penyedia-distributor-detail',
            'komoditas-detail',
            'penyedia-detail'
        ];
        if (detailEndpoints.some(de => endpoint.includes(de))) {
            return NextResponse.json(
                {
                    error: 'This endpoint requires a specific ID parameter and cannot be synced in bulk',
                    hint: 'Detail endpoints need additional parameters like kd_distributor or kd_komoditas'
                },
                { status: 400 }
            );
        }

        // Ensure folder exists
        await ensureEndpointFolder(endpoint);

        // Get current sync state
        const currentState = await getSyncState(endpoint, year);

        // Check if file actually exists - if not, reset sync state
        const fileInfo = await getFileInfo(endpoint, year);
        let currentCursor: string | null = null;
        let finalVerification: 'verified' | 'mismatch' | 'unchecked' = 'unchecked';

        if (fileInfo.exists && currentState?.lastCursor) {
            // File exists and we have a cursor, continue from where we left off
            currentCursor = currentState.lastCursor;
            console.log(`Continuing sync from cursor for ${endpoint} ${year}`);
        } else if (!fileInfo.exists && currentState?.totalRecords) {
            // File was deleted but state exists, reset and start fresh
            console.log(`File missing for ${endpoint} ${year}, starting fresh sync`);
            currentCursor = null;
        } else {
            console.log(`Starting new sync for ${endpoint} ${year}`);
        }

        let totalNewRecords = 0;
        let totalDuplicatesSkipped = 0;
        let pagesFetched = 0;
        let isComplete = false;

        const accumulatedData: any[] = [];
        let finalCursor: string | null = currentCursor;

        // Fetch data in pages
        while (pagesFetched < maxPages) {
            // Build API URL
            let apiUrl = `${BASE_URL}${endpoint}?limit=${batchSize}&tahun=${year}`;

            // Add kode_klpd for ALL endpoints (both V1 and Legacy require it)
            if (endpoint.startsWith('/v1/')) {
                apiUrl += `&kode_klpd=K34`;
            } else {
                apiUrl += `&kode_klpd=K34`; // Explicitly for legacy too as confirmed
            }

            if (currentCursor) {
                apiUrl += `&cursor=${encodeURIComponent(currentCursor)}`;
            }

            // Fetch from INAPROC API with retry
            try {
                const res = await fetchWithRetry(apiUrl, {
                    headers: {
                        'Authorization': `Bearer ${JWT_TOKEN}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                });

                if (!res.ok) {
                    const errorText = await res.text().catch(() => 'Unknown error');
                    throw new Error(`API Error: ${res.status} - ${errorText}`);
                }

                const result = await res.json();

                // Legacy API returns data as direct array, V1 returns {data: [...]}
                let pageData: any[];
                let hasMoreData = false;
                let nextCursor: string | null = null;

                if (Array.isArray(result)) {
                    // Legacy API: direct array response (no pagination)
                    pageData = result;
                    hasMoreData = false; // Legacy APIs typically return all data at once
                } else {
                    // V1 API: wrapped in data field with pagination
                    pageData = result.data || result.rs || [];
                    nextCursor = result.cursor || (result.meta && result.meta.cursor) || null;
                    hasMoreData = !!nextCursor && result.has_more !== false;
                }

                if (pageData.length === 0) {
                    // No more data on this page
                    if (pagesFetched === 0 && accumulatedData.length === 0) {
                        isComplete = true; // Truly empty
                    }
                    break;
                }

                // Accumulate data
                accumulatedData.push(...pageData);

                // Update cursors for next iteration
                finalCursor = nextCursor;
                currentCursor = nextCursor;
                pagesFetched++;

                // Check if we should continue fetching
                if (!hasMoreData) {
                    isComplete = true;
                    break;
                }

                // Small delay to be nice to the API
                await new Promise((r) => setTimeout(r, 200));

            } catch (error: any) {
                console.error(`Error during sync page ${pagesFetched + 1}:`, error);
                // Stop fetching on error, but save what we have accumulated so far
                break;
            }
        }

        // Bulk Write to Excel (if we have data)
        if (accumulatedData.length > 0) {
            console.log(`Bulk writing ${accumulatedData.length} records...`);

            let excelResult;

            const isLegacy = endpoint.startsWith('/legacy/');

            // For Legacy + Complete Fetch, use Overwrite to ensure no duplicates
            if (isLegacy && isComplete) {
                console.log('Legacy Endpoint + Full Fetch detected: Using Overwrite Strategy');
                excelResult = await overwriteExcel(endpoint, year, accumulatedData);
            } else {
                if (isLegacy && !isComplete) {
                    console.warn('Legacy sync incomplete! Falling back to Append Strategy.');
                }
                const res = await appendToExcel(endpoint, year, accumulatedData);
                excelResult = res;
            }

            if (!excelResult.success) {
                throw new Error(excelResult.error || 'Failed to append to Excel');
            }

            totalNewRecords = excelResult.newRecords;
            totalDuplicatesSkipped = excelResult.duplicatesSkipped;

            // Update state ONLY after successful write
            const newState = {
                lastCursor: finalCursor || null,
                totalRecords: excelResult.totalRecords,
                filePath: excelResult.filePath,
            };

            await updateSyncState(endpoint, year, newState);

            // Final verification logic
            if (isComplete) {
                const finalFileCheck = await getFileInfo(endpoint, year, false);
                if (finalFileCheck.recordCount === newState.totalRecords) {
                    finalVerification = 'verified';
                } else {
                    finalVerification = 'mismatch';
                }
            }
        } else if (isComplete && totalNewRecords === 0) {
            // Handle case where we marked generic complete but had no data to write (e.g. empty final page or legacy empty)
            // We still might need to verify existing state if we thought we were starting fresh?
            // But usually if accumulatedData is 0, we did nothing.
        }

        // Get final file info (using fastMode=false since we need exact record count for verification)
        const finalFileInfo = await getFileInfo(endpoint, year, false);

        // If we didn't verify inside the loop (e.g. maxPages hit), verify now
        if (finalVerification === 'unchecked' && isComplete) {
            const currentState = await getSyncState(endpoint, year);
            if (currentState && currentState.totalRecords === finalFileInfo.recordCount) {
                finalVerification = 'verified';
            } else {
                finalVerification = 'mismatch';
            }
        }

        const syncResult: SyncResult = {
            success: true,
            endpoint,
            year,
            newRecords: totalNewRecords,
            duplicatesSkipped: totalDuplicatesSkipped,
            totalRecords: finalFileInfo.recordCount,
            filePath: getFilePath(endpoint, year),
            isComplete,
            verificationStatus: finalVerification
        };

        return NextResponse.json(syncResult);
    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message,
            },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    // GET method for checking sync status
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');
    const year = searchParams.get('year');

    if (!endpoint || !year) {
        return NextResponse.json(
            { error: 'Missing required params: endpoint, year' },
            { status: 400 }
        );
    }

    try {
        const state = await getSyncState(endpoint, year);
        const fileInfo = await getFileInfo(endpoint, year);

        return NextResponse.json({
            endpoint,
            year,
            syncState: state,
            fileInfo,
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
