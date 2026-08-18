/**
 * Storage Service
 *
 * Every dataset is kept in three formats: .json, .csv and .xlsx.
 *
 * JSON is canonical -- it is what dedup reads and what the other two are
 * generated from. That choice is load-bearing:
 *   - XLSX caps out at 1,048,576 rows; the RUP datasets are within reach of it.
 *   - Parsing JSON is roughly an order of magnitude cheaper than parsing XLSX,
 *     and the canonical file is re-read on every sync batch.
 *   - JSON round-trips null and numeric types; CSV and XLSX both flatten them.
 *
 * CSV and XLSX are regenerated when a sync finishes rather than on every batch,
 * so the cost of the extra formats is paid once per sync instead of per page.
 *
 * All writes go to a temporary file and are then renamed, so an interrupted
 * write cannot leave a half-written dataset behind.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
    CANONICAL_FORMAT,
    STORAGE_FORMATS,
    type StorageFormat,
    getDatasetPaths,
    type DatasetPaths,
} from './drive-config';
import type { DataRecord } from './response-adapter';
import { recordKey, toCsv, toWorkbook } from './dataset-format';

export { recordKey, toCsv, toWorkbook };

export interface DatasetMeta {
    endpoint: string;
    year: string | null;
    /** Key fields in force when the canonical file was last written. */
    keyFields: string[] | null;
    rowCount: number;
    lastUpdated: string;
    /** How the last write was performed, for troubleshooting. */
    lastWriteMode: 'append' | 'overwrite' | 'snapshot';
}

export interface WriteResult {
    newRecords: number;
    duplicatesSkipped: number;
    totalRecords: number;
    paths: DatasetPaths;
}

// ---------------------------------------------------------------------------
// Atomic IO
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

/**
 * Write via a sibling temp file plus rename. Rename is atomic on both NTFS and
 * POSIX, so readers either see the previous file or the complete new one.
 */
async function writeAtomic(filePath: string, data: string | Buffer): Promise<void> {
    await ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
        await fs.writeFile(tmp, data);
        await fs.rename(tmp, filePath);
    } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw) as T;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return null;
        console.error(`[storage] Unreadable JSON at ${filePath}:`, error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Canonical store
// ---------------------------------------------------------------------------

export async function readCanonical(endpoint: string, year?: string): Promise<DataRecord[]> {
    const { json } = getDatasetPaths(endpoint, year);
    const records = await readJsonFile<DataRecord[]>(json);
    return Array.isArray(records) ? records : [];
}

export async function readMeta(endpoint: string, year?: string): Promise<DatasetMeta | null> {
    const { meta } = getDatasetPaths(endpoint, year);
    return readJsonFile<DatasetMeta>(meta);
}

// ---------------------------------------------------------------------------
// Derived formats
// ---------------------------------------------------------------------------

/**
 * Regenerate .csv and .xlsx from the canonical .json.
 *
 * Called when a sync completes, and available on demand, so the three formats
 * are always consistent with each other.
 */
export async function materializeDerived(
    endpoint: string,
    year?: string,
    records?: DataRecord[],
): Promise<{ csv: string; xlsx: string; rowCount: number }> {
    const paths = getDatasetPaths(endpoint, year);
    const rows = records ?? (await readCanonical(endpoint, year));

    await writeAtomic(paths.csv, toCsv(rows));

    const sheetLabel = year ? `Data ${year}` : 'Data';
    const workbook = toWorkbook(rows, sheetLabel);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await writeAtomic(paths.xlsx, buffer);

    return { csv: paths.csv, xlsx: paths.xlsx, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function writeCanonical(
    endpoint: string,
    year: string | undefined,
    records: DataRecord[],
    keyFields: string[] | null,
    mode: DatasetMeta['lastWriteMode'],
): Promise<DatasetPaths> {
    const paths = getDatasetPaths(endpoint, year);

    await writeAtomic(paths.json, JSON.stringify(records));

    const meta: DatasetMeta = {
        endpoint,
        year: year ?? null,
        keyFields,
        rowCount: records.length,
        lastUpdated: new Date().toISOString(),
        lastWriteMode: mode,
    };
    await writeAtomic(paths.meta, JSON.stringify(meta, null, 2));

    return paths;
}

/**
 * Merge new records into the canonical file, skipping ones already present.
 *
 * If the key fields changed since the last write, every existing key is
 * recomputed with the current fields. Previously the existing set was built
 * with whatever was stored while incoming records used the current definition,
 * so the two could never match and dedup silently stopped working.
 */
export async function appendRecords(
    endpoint: string,
    year: string | undefined,
    incoming: DataRecord[],
    keyFields: string[] | null | undefined,
): Promise<WriteResult> {
    const existing = await readCanonical(endpoint, year);
    const storedMeta = await readMeta(endpoint, year);
    const effectiveKeys = keyFields ?? null;

    const storedKeys = storedMeta?.keyFields ?? null;
    if (existing.length > 0 && JSON.stringify(storedKeys) !== JSON.stringify(effectiveKeys)) {
        console.warn(
            `[storage] ${endpoint}: key fields changed from ${JSON.stringify(storedKeys)} to ` +
            `${JSON.stringify(effectiveKeys)}; rebuilding the dedup index.`,
        );
    }

    const seen = new Set<string>();
    for (const record of existing) {
        seen.add(recordKey(record, effectiveKeys));
    }

    const merged = existing.slice();
    let duplicatesSkipped = 0;

    for (const record of incoming) {
        const key = recordKey(record, effectiveKeys);
        if (seen.has(key)) {
            duplicatesSkipped++;
            continue;
        }
        seen.add(key);
        merged.push(record);
    }

    const paths = await writeCanonical(endpoint, year, merged, effectiveKeys, 'append');

    return {
        newRecords: merged.length - existing.length,
        duplicatesSkipped,
        totalRecords: merged.length,
        paths,
    };
}

/** Replace the dataset wholesale. Used when an endpoint returns everything. */
export async function overwriteRecords(
    endpoint: string,
    year: string | undefined,
    records: DataRecord[],
    keyFields: string[] | null | undefined,
): Promise<WriteResult> {
    const paths = await writeCanonical(endpoint, year, records, keyFields ?? null, 'overwrite');

    return {
        newRecords: records.length,
        duplicatesSkipped: 0,
        totalRecords: records.length,
        paths,
    };
}

/**
 * Append a point-in-time capture without deduplicating.
 *
 * Dashboard endpoints return aggregates whose values change between runs; two
 * captures with identical totals are still two distinct observations, so the
 * `_snapshot_at` stamp is what makes them separate rows.
 */
export async function appendSnapshot(
    endpoint: string,
    year: string | undefined,
    rows: DataRecord[],
): Promise<WriteResult> {
    const existing = await readCanonical(endpoint, year);
    const merged = [...existing, ...rows];
    const paths = await writeCanonical(endpoint, year, merged, null, 'snapshot');

    return {
        newRecords: rows.length,
        duplicatesSkipped: 0,
        totalRecords: merged.length,
        paths,
    };
}

// ---------------------------------------------------------------------------
// Inspection & removal
// ---------------------------------------------------------------------------

export interface FormatInfo {
    exists: boolean;
    path: string;
    size: number;
}

export interface DatasetInfo {
    exists: boolean;
    rowCount: number;
    lastUpdated: string | null;
    formats: Record<StorageFormat, FormatInfo>;
    /** True when csv/xlsx are missing or older than the canonical json. */
    derivedStale: boolean;
}

/**
 * Describe a dataset without parsing it. Row count comes from the sidecar, so
 * this stays cheap enough for the status endpoint to poll.
 */
export async function getDatasetInfo(endpoint: string, year?: string): Promise<DatasetInfo> {
    const paths = getDatasetPaths(endpoint, year);

    const stats = await Promise.all(
        STORAGE_FORMATS.map(async (format) => {
            try {
                const stat = await fs.stat(paths[format]);
                return [format, { exists: true, path: paths[format], size: stat.size, mtime: stat.mtimeMs }] as const;
            } catch {
                return [format, { exists: false, path: paths[format], size: 0, mtime: 0 }] as const;
            }
        }),
    );

    const formats = Object.fromEntries(
        stats.map(([format, info]) => [format, { exists: info.exists, path: info.path, size: info.size }]),
    ) as Record<StorageFormat, FormatInfo>;

    const mtimes = Object.fromEntries(stats.map(([format, info]) => [format, info.mtime]));
    const canonicalExists = formats[CANONICAL_FORMAT].exists;
    const meta = canonicalExists ? await readMeta(endpoint, year) : null;

    const derivedStale = canonicalExists
        ? STORAGE_FORMATS.filter((f) => f !== CANONICAL_FORMAT).some(
            (f) => !formats[f].exists || mtimes[f] < mtimes[CANONICAL_FORMAT],
        )
        : false;

    return {
        exists: canonicalExists,
        rowCount: meta?.rowCount ?? 0,
        lastUpdated: meta?.lastUpdated ?? null,
        formats,
        derivedStale,
    };
}

/** Remove every file belonging to a dataset. */
export async function deleteDataset(endpoint: string, year?: string): Promise<void> {
    const paths = getDatasetPaths(endpoint, year);

    await Promise.all(
        [paths.json, paths.csv, paths.xlsx, paths.meta].map((file) =>
            fs.rm(file, { force: true }),
        ),
    );
}

/** Synchronous existence check for the canonical file, for hot status paths. */
export function canonicalExistsSync(endpoint: string, year?: string): boolean {
    return fsSync.existsSync(getDatasetPaths(endpoint, year).json);
}
