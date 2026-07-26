/**
 * Response Adapter
 *
 * The INAPROC API returns at least six different envelopes, and they are not
 * consistent even within one family: /v1/dashboard/rup/table wraps its payload
 * in `success`, while /v1/dashboard/realisasi/table does not. Detection is
 * therefore structural -- the registry's declared `shape` is only used to warn
 * when reality disagrees.
 *
 * Everything downstream (sync, browse, export) consumes the normalised form.
 */

import type { ResponseShape } from './endpoint-registry';

export type DataRecord = Record<string, unknown>;

export interface AdaptedResponse {
    rows: DataRecord[];
    /** Cursor for the next page, or null when there is nothing more to ask for. */
    cursor: string | null;
    /** True only when a further request can actually be made (needs a cursor). */
    hasMore: boolean;
    /** Envelope we actually found, for logging against the declared shape. */
    detectedShape: ResponseShape;
    /** Set when the API answered with a business-level failure (success: false). */
    apiError: { code: string; message: string } | null;
}

function isPlainObject(value: unknown): value is DataRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecordArray(value: unknown): DataRecord[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isPlainObject);
}

/**
 * Pull the pagination cursor. v1 datasets put it in `meta.cursor`; a few
 * endpoints expose it at the top level.
 */
function extractCursor(payload: DataRecord): string | null {
    const meta = isPlainObject(payload.meta) ? payload.meta : null;
    const candidate = payload.cursor ?? meta?.cursor;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * Resolve "is there another page".
 *
 * The flag lives in `meta.has_more`, not at the top level -- reading the top
 * level made the check silently vacuous (`undefined !== false`). Even when the
 * API says there is more, we cannot fetch it without a cursor, so a missing
 * cursor always ends pagination.
 */
function extractHasMore(payload: DataRecord, cursor: string | null): boolean {
    if (!cursor) return false;

    const meta = isPlainObject(payload.meta) ? payload.meta : null;
    const flag = typeof meta?.has_more === 'boolean' ? meta.has_more : payload.has_more;

    return typeof flag === 'boolean' ? flag : true;
}

function extractApiError(payload: DataRecord): AdaptedResponse['apiError'] {
    if (payload.success !== false) return null;

    const err = isPlainObject(payload.error) ? payload.error : {};
    return {
        code: typeof err.code === 'string' ? err.code : 'unknown',
        message: typeof err.message === 'string' ? err.message : 'Permintaan ditolak API',
    };
}

export interface AdaptOptions {
    /**
     * ISO timestamp stamped onto every row as `_snapshot_at`. Supplied for
     * dashboard endpoints, whose values are point-in-time aggregates and would
     * otherwise be indistinguishable between runs.
     */
    snapshotAt?: string;
    /** Declared shape from the registry, used only to log drift. */
    expectedShape?: ResponseShape;
    /** Endpoint path, for log messages. */
    endpoint?: string;
}

/**
 * Normalise any INAPROC response into rows plus pagination state.
 *
 * Aggregate payloads (a bare object of totals) become exactly one row, so a
 * summary reads as a single-row dataset rather than a special case.
 */
export function adaptResponse(payload: unknown, options: AdaptOptions = {}): AdaptedResponse {
    const { snapshotAt, expectedShape, endpoint } = options;

    const base = (rows: DataRecord[], shape: ResponseShape, rest: Partial<AdaptedResponse> = {}): AdaptedResponse => {
        const stamped = snapshotAt
            ? rows.map((row) => ({ ...row, _snapshot_at: snapshotAt }))
            : rows;

        if (expectedShape && shape !== expectedShape && endpoint) {
            console.warn(`[adapter] ${endpoint}: expected shape "${expectedShape}" but found "${shape}"`);
        }

        return { rows: stamped, cursor: null, hasMore: false, detectedShape: shape, apiError: null, ...rest };
    };

    // Legacy endpoints: the payload is the array itself, everything at once.
    if (Array.isArray(payload)) {
        return base(asRecordArray(payload), 'array');
    }

    if (!isPlainObject(payload)) {
        return base([], 'array');
    }

    const apiError = extractApiError(payload);
    if (apiError) {
        return { ...base([], expectedShape ?? 'object'), apiError };
    }

    const cursor = extractCursor(payload);
    const hasMore = extractHasMore(payload, cursor);
    const pagination = { cursor, hasMore };

    // `rs` is an older alias for `data` still used by a few endpoints.
    const container = payload.data ?? payload.rs;

    // { data: [ ... ] } -- the standard v1 dataset.
    if (Array.isArray(container)) {
        return base(asRecordArray(container), 'data-array', pagination);
    }

    // { data: null } with success: true means "no records", not an error.
    if (container === null || container === undefined) {
        return base([], 'data-array', pagination);
    }

    if (isPlainObject(container)) {
        // { data: { items: [ ... ] } } -- dashboard geo/*
        if (Array.isArray(container.items)) {
            return base(asRecordArray(container.items), 'items', pagination);
        }

        // { data: { rows: [ ... ] } } -- dashboard table
        if (Array.isArray(container.rows)) {
            return base(asRecordArray(container.rows), 'rows', pagination);
        }

        // { data: { data: { ... } } } -- dashboard profil/precomputed
        if (isPlainObject(container.data)) {
            return base([container.data], 'nested', pagination);
        }

        // { data: { ...totals } } -- dashboard summary / last-update
        return base([container], 'object', pagination);
    }

    return base([], 'object', pagination);
}
