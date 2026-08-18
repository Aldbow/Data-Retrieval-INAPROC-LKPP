/**
 * INAPROC API Client
 *
 * One place that knows how to talk to the upstream API: URL construction from
 * endpoint metadata, auth, timeouts and retry. Route handlers use this instead
 * of assembling URLs themselves.
 */

import { API_BASE_URL, KLPD_JENIS, KODE_KLPD } from './drive-config';
import { getEndpoint, isKnownEndpoint } from './endpoint-registry';
import { adaptResponse, type AdaptedResponse } from './response-adapter';

const RETRY = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10_000,
    timeoutMs: 30_000,
};

/** Statuses worth retrying: transient upstream faults and rate limiting. */
const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        /** Upstream body, for server-side logs only -- never sent to the client. */
        readonly detail?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface RequestParams {
    year?: string;
    cursor?: string | null;
    /** Row offset for offset-paginated endpoints. Ignored by the other styles. */
    offset?: number;
    limit?: number;
}

/**
 * Build the upstream URL for an endpoint, applying only the query parameters
 * that endpoint actually accepts.
 */
export function buildApiUrl(endpoint: string, params: RequestParams = {}): string {
    const def = getEndpoint(endpoint);
    if (!def) {
        throw new ApiError(`Unknown endpoint: ${endpoint}`, 400);
    }

    const query = new URLSearchParams();

    if (def.yearScoped && params.year) query.set('tahun', params.year);
    if (def.klpdScoped) query.set('kode_klpd', KODE_KLPD);
    if (def.jenisScoped) query.set('jenis', KLPD_JENIS);
    // Same code namespace as kode_klpd -- dashboard/*/geo/instansi reports our
    // institution as 'K34' too -- so it is derived rather than configured twice.
    if (def.instansiScoped) query.set('instansi', KODE_KLPD);
    if (params.limit) query.set('limit', String(params.limit));
    if (def.pagination === 'cursor' && params.cursor) query.set('cursor', params.cursor);
    if (def.pagination === 'offset' && params.offset) query.set('offset', String(params.offset));

    const suffix = query.toString();
    return suffix ? `${API_BASE_URL}${endpoint}?${suffix}` : `${API_BASE_URL}${endpoint}`;
}

function getToken(): string {
    const token = process.env.JWT_TOKEN;
    if (!token) {
        throw new ApiError('JWT_TOKEN is not configured', 500);
    }
    return token;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET with timeout and exponential backoff.
 *
 * The abort timer is always cleared, including on the failure path, so a slow
 * request cannot leave a pending timer behind.
 */
async function fetchWithRetry(url: string): Promise<Response> {
    const token = getToken();
    let lastError: unknown;

    for (let attempt = 0; attempt < RETRY.maxAttempts; attempt++) {
        if (attempt > 0) {
            const delay = Math.min(RETRY.initialDelayMs * 2 ** (attempt - 1), RETRY.maxDelayMs);
            await sleep(delay);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RETRY.timeoutMs);

        try {
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
            });

            if (RETRIABLE_STATUSES.has(response.status)) {
                lastError = new ApiError(`Upstream returned ${response.status}`, response.status);
                continue;
            }

            return response;
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new ApiError('Upstream request failed', 502);
}

export interface FetchPageOptions extends RequestParams {
    /** Stamp rows with `_snapshot_at`; used for dashboard aggregates. */
    snapshotAt?: string;
}

/**
 * Fetch one page and return it normalised.
 *
 * Throws ApiError for transport and HTTP failures; a business-level rejection
 * from the API surfaces as `apiError` on the result instead, because those are
 * expected for endpoints whose required parameters we do not know.
 */
export async function fetchPage(endpoint: string, options: FetchPageOptions = {}): Promise<AdaptedResponse> {
    if (!isKnownEndpoint(endpoint)) {
        throw new ApiError(`Unknown endpoint: ${endpoint}`, 400);
    }

    const def = getEndpoint(endpoint)!;
    const url = buildApiUrl(endpoint, options);
    const response = await fetchWithRetry(url);

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ApiError(`Upstream returned ${response.status}`, response.status, detail);
    }

    const payload = await response.json();

    return adaptResponse(payload, {
        snapshotAt: options.snapshotAt,
        expectedShape: def.shape,
        endpoint,
    });
}
