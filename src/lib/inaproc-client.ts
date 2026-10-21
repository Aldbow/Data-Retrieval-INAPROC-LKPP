/**
 * INAPROC API Client
 *
 * One place that knows how to talk to the upstream API: URL construction from
 * endpoint metadata, auth, timeouts and retry. Route handlers use this instead
 * of assembling URLs themselves.
 */

import { API_BASE_URL, KLPD_JENIS, KODE_KLPD } from './drive-config.ts';
import { getEndpoint, isKnownEndpoint } from './endpoint-registry.ts';
import { adaptResponse, type AdaptedResponse } from './response-adapter.ts';

/**
 * Five attempts back off 1s, 2s, 4s, 8s: about 15 seconds of grace. The API
 * has short 503 spells -- observed 2026-10-21, two consecutive syncs failed
 * and the same endpoints answered 200 a few minutes later -- and the previous
 * three attempts gave up after roughly 3 seconds, too soon to ride one out.
 *
 * Exported so tests can shorten the delays; nothing else should change it.
 */
export const RETRY = {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 10_000,
    timeoutMs: 30_000,
};

/** Statuses worth retrying: transient upstream faults and rate limiting. */
const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
    readonly status: number;
    /** Upstream body, for server-side logs only -- never sent to the client. */
    readonly detail?: string;

    constructor(message: string, status: number, detail?: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.detail = detail;
    }
}

/**
 * The API could not be reached, or answered with a transient failure, on
 * every attempt. Nothing about the request is wrong, so the browser is told
 * what happened and to try again later, instead of the generic "check the
 * server log" that an unexpected failure gets.
 */
export class UpstreamUnavailableError extends ApiError {
    /** Written by us, never upstream text, so it is safe to show the user. */
    readonly userMessage: string;

    constructor(message: string, status: number, userMessage: string) {
        super(message, status);
        this.name = 'UpstreamUnavailableError';
        this.userMessage = userMessage;
    }
}

function unavailableFromStatus(status: number, attempts: number): UpstreamUnavailableError {
    const userMessage = status === 429
        ? 'API INAPROC sedang membatasi jumlah permintaan (HTTP 429). Tunggu beberapa menit, lalu coba lagi.'
        : `Server API INAPROC sedang tidak tersedia (HTTP ${status}). Coba lagi beberapa menit lagi.`;
    return new UpstreamUnavailableError(`Upstream returned ${status} (${attempts} attempts)`, status, userMessage);
}

function unavailableFromTransport(error: unknown, timedOut: boolean, attempts: number): UpstreamUnavailableError {
    if (timedOut) {
        return new UpstreamUnavailableError(
            `Upstream timed out after ${RETRY.timeoutMs}ms (${attempts} attempts)`,
            504,
            `API INAPROC tidak merespons dalam ${RETRY.timeoutMs / 1000} detik. Coba lagi beberapa menit lagi.`,
        );
    }

    const reason = error instanceof Error ? error.message : String(error);
    return new UpstreamUnavailableError(
        `Upstream unreachable: ${reason} (${attempts} attempts)`,
        502,
        'API INAPROC tidak dapat dihubungi. Periksa koneksi internet, lalu coba lagi.',
    );
}

/**
 * HTTP status and message for the browser when a route's call to the API
 * failed. `fallback` covers everything that is not a known upstream outage.
 */
export function describeFailure(error: unknown, fallback: string): { status: number; message: string } {
    if (error instanceof UpstreamUnavailableError) {
        return { status: 503, message: error.userMessage };
    }

    const status = error instanceof ApiError && error.status === 500 ? 500 : 502;
    return { status, message: fallback };
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
 * request cannot leave a pending timer behind. Exhausting every attempt throws
 * UpstreamUnavailableError, describing the last failure seen.
 */
async function fetchWithRetry(url: string): Promise<Response> {
    const token = getToken();
    let lastError: UpstreamUnavailableError | null = null;

    for (let attempt = 0; attempt < RETRY.maxAttempts; attempt++) {
        if (attempt > 0) {
            const delay = Math.min(RETRY.initialDelayMs * 2 ** (attempt - 1), RETRY.maxDelayMs);
            await sleep(delay);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RETRY.timeoutMs);
        const attempts = attempt + 1;

        try {
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
            });

            if (RETRIABLE_STATUSES.has(response.status)) {
                // Release the connection; the body of an error page is not needed.
                await response.body?.cancel().catch(() => {});
                lastError = unavailableFromStatus(response.status, attempts);
                continue;
            }

            return response;
        } catch (error) {
            lastError = unavailableFromTransport(error, controller.signal.aborted, attempts);
        } finally {
            clearTimeout(timer);
        }
    }

    // maxAttempts is at least 1, so the loop always records a failure first.
    throw lastError!;
}

/**
 * Read a `success: false` envelope out of an error response body, or return
 * null when the body is not one (an HTML error page, a proxy timeout, ...),
 * which stays a thrown ApiError.
 */
function parseRejection(body: string): AdaptedResponse | null {
    if (!body) return null;

    let payload: unknown;
    try {
        payload = JSON.parse(body);
    } catch {
        return null;
    }

    if (typeof payload !== 'object' || payload === null) return null;
    if ((payload as Record<string, unknown>).success !== false) return null;

    const adapted = adaptResponse(payload);
    return adapted.apiError ? adapted : null;
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

        // The API delivers business rejections with a 4xx status AND a
        // `success: false` envelope naming the reason (e.g. 400 + code 1004,
        // "Permintaan tidak valid"). Throwing on the status alone discarded
        // that body and reported only "Upstream returned 400", so surface it
        // through the same `apiError` channel as a 200-wrapped rejection.
        const rejection = parseRejection(detail);
        if (rejection) {
            return { ...rejection, detectedShape: def.shape };
        }

        throw new ApiError(`Upstream returned ${response.status}`, response.status, detail);
    }

    const payload = await response.json();

    return adaptResponse(payload, {
        snapshotAt: options.snapshotAt,
        expectedShape: def.shape,
        endpoint,
    });
}
