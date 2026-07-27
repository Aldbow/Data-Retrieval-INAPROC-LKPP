/**
 * Storage Layout & Path Safety
 *
 * Resolves where a dataset lives on disk, in all three formats. Every path that
 * incorporates caller-supplied input goes through `resolveWithin`, which
 * guarantees the result stays under the configured base directory.
 */

import * as path from 'path';

/**
 * Root of the local data store.
 *
 * A single variable on purpose. There used to be two (`SYNC_LOCATION` and
 * `INAPROC_DATA_PATH`) where the first won, so a value meant for the state file
 * silently became the root for every dataset.
 */
export const DATA_ROOT: string = process.env.INAPROC_DATA_PATH
    ? path.resolve(process.env.INAPROC_DATA_PATH)
    : path.join(process.cwd(), 'DATA');

/** KLPD (institution) code sent as ?kode_klpd=. K34 is the historical default. */
export const KODE_KLPD: string = process.env.INAPROC_KODE_KLPD || 'K34';

/**
 * KLPD type sent as ?jenis= on dashboard endpoints.
 *
 * 1=Kementerian 2=Lembaga 3=Provinsi 4=Kabupaten 5=Kota. Must describe the same
 * institution as KODE_KLPD -- the dashboard returns the wrong population when
 * the two disagree, and geo/* comes back empty without it entirely.
 */
export const KLPD_JENIS: string = process.env.INAPROC_KLPD_JENIS || '1';

/** Base URL of the upstream API, shared by every route. */
export const API_BASE_URL: string = process.env.INAPROC_API_BASE_URL || 'https://data.inaproc.id/api';

export const SYNC_STATE_FILE: string = path.join(DATA_ROOT, 'sync-state.json');

export type StorageFormat = 'json' | 'csv' | 'xlsx';

export const STORAGE_FORMATS: readonly StorageFormat[] = ['json', 'csv', 'xlsx'] as const;

/** Canonical format: what dedup reads and what the other two are derived from. */
export const CANONICAL_FORMAT: StorageFormat = 'json';

export class UnsafePathError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsafePathError';
    }
}

/**
 * Join untrusted segments onto a base directory and refuse to escape it.
 *
 * `path.join` happily resolves '..', so a year of '../../../etc/passwd' used to
 * turn into an arbitrary write (and, with forceOverwrite, an arbitrary delete).
 */
export function resolveWithin(base: string, ...segments: string[]): string {
    const resolvedBase = path.resolve(base);
    const candidate = path.resolve(resolvedBase, ...segments);
    const relative = path.relative(resolvedBase, candidate);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new UnsafePathError(`Resolved path escapes the data root: ${segments.join('/')}`);
    }

    return candidate;
}

const YEAR_PATTERN = /^\d{4}$/;

/** Years the app is willing to address. Anything else is rejected outright. */
export function isValidYear(year: unknown): year is string {
    if (typeof year !== 'string' || !YEAR_PATTERN.test(year)) return false;
    const n = Number(year);
    return n >= 2000 && n <= 2100;
}

export function assertValidYear(year: unknown): asserts year is string {
    if (!isValidYear(year)) {
        throw new UnsafePathError(`Invalid year: expected 4 digits between 2000 and 2100`);
    }
}

/** Path segments must be plain slugs; nothing that could redirect the path. */
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function assertSafeSegments(endpoint: string): string[] {
    const segments = endpoint.split('/').filter(Boolean);

    if (segments.length < 2) {
        throw new UnsafePathError(`Endpoint has too few path segments: ${endpoint}`);
    }

    for (const segment of segments) {
        if (!SEGMENT_PATTERN.test(segment)) {
            throw new UnsafePathError(`Endpoint contains an unsafe path segment: ${segment}`);
        }
    }

    return segments;
}

export interface DatasetPaths {
    /** Directory holding all three files. */
    dir: string;
    /** Shared filename without extension, e.g. 'master-satker_2025'. */
    stem: string;
    json: string;
    csv: string;
    xlsx: string;
    /** Sidecar holding dedup keys and provenance for this dataset. */
    meta: string;
}

/**
 * Where a dataset's files live.
 *
 * Directory mirrors the endpoint path minus its last segment, which becomes the
 * filename: '/v1/dashboard/realisasi/geo/satker' + 2025
 *   -> <root>/v1/dashboard/realisasi/geo/satker_2025.{json,csv,xlsx}
 *
 * `year` is omitted for endpoints that are not year-scoped (reference data,
 * /v1/dashboard/last-update).
 */
export function getDatasetPaths(endpoint: string, year?: string): DatasetPaths {
    const segments = assertSafeSegments(endpoint);
    const name = segments[segments.length - 1];
    const folders = segments.slice(0, -1);

    if (year !== undefined) {
        assertValidYear(year);
    }

    const dir = resolveWithin(DATA_ROOT, ...folders);
    const stem = year !== undefined ? `${name}_${year}` : name;

    return {
        dir,
        stem,
        json: resolveWithin(dir, `${stem}.json`),
        csv: resolveWithin(dir, `${stem}.csv`),
        xlsx: resolveWithin(dir, `${stem}.xlsx`),
        meta: resolveWithin(dir, `${stem}.meta.json`),
    };
}

/** Convenience accessor for a single format. */
export function getDatasetPath(endpoint: string, year: string | undefined, format: StorageFormat): string {
    return getDatasetPaths(endpoint, year)[format];
}
