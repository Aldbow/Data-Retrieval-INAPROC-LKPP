/**
 * Dataset Formatting
 *
 * Pure transforms shared by the storage and export layers: record identity, CSV
 * serialisation and workbook construction. Deliberately free of filesystem and
 * configuration imports so it can be reasoned about and tested on its own.
 */

import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import type { DataRecord } from './response-adapter';

/** Hard limit of the xlsx format, minus the header row. */
export const XLSX_MAX_ROWS_PER_SHEET = 1_048_575;

/** Column added to dashboard rows to distinguish successive captures. */
export const SNAPSHOT_FIELD = '_snapshot_at';

/**
 * Stable fingerprint of an entire record, used when an endpoint's natural key
 * is unknown. Keys are sorted so property order from the API cannot change the
 * result -- hashing `JSON.stringify(record)` directly produced a different key
 * whenever the API reordered its fields, so nothing ever matched.
 *
 * The snapshot stamp is excluded: two captures of the same underlying row
 * should still be recognised as the same row.
 */
export function stableHash(record: DataRecord): string {
    const normalised = Object.keys(record)
        .filter((key) => key !== SNAPSHOT_FIELD)
        .sort()
        .map((key) => `${key}=${String(record[key])}`)
        .join('');

    return `#${createHash('sha1').update(normalised).digest('hex')}`;
}

/**
 * Identity of a record under the given key fields.
 *
 * A field may be written 'a||b' meaning "use whichever of these is present",
 * which bridges the v1/legacy naming split (kode_rup vs kd_rup). When no key
 * fields are configured, or none of them carry a value, the whole record is
 * hashed instead: keeping a duplicate is recoverable, dropping a distinct
 * record as a false duplicate is not.
 */
export function recordKey(record: DataRecord, keyFields: string[] | null | undefined): string {
    if (!keyFields || keyFields.length === 0) {
        return stableHash(record);
    }

    const parts: string[] = [];
    let sawValue = false;

    for (const field of keyFields) {
        const candidates = field.includes('||') ? field.split('||') : [field];
        let value = '';

        for (const name of candidates) {
            const raw = record[name];
            if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
                value = String(raw);
                break;
            }
        }

        if (value !== '') sawValue = true;
        parts.push(value);
    }

    return sawValue ? parts.join('|') : stableHash(record);
}

/** Union of every column across all records, preserving first-seen order. */
export function collectColumns(records: DataRecord[]): string[] {
    const columns: string[] = [];
    const seen = new Set<string>();

    for (const record of records) {
        for (const key of Object.keys(record)) {
            if (!seen.has(key)) {
                seen.add(key);
                columns.push(key);
            }
        }
    }

    return columns;
}

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';

    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);

    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV over the union of all columns. */
export function toCsv(records: DataRecord[]): string {
    const columns = collectColumns(records);
    if (columns.length === 0) return '';

    const lines = [columns.map(csvCell).join(',')];

    for (const record of records) {
        lines.push(columns.map((column) => csvCell(record[column])).join(','));
    }

    // Trailing newline so the file ends cleanly for line-oriented tools.
    return `${lines.join('\r\n')}\r\n`;
}

/**
 * Build a workbook, splitting across sheets when the row cap is exceeded.
 * Without this an oversized dataset silently loses everything past row
 * 1,048,576 -- reachable with the larger RUP datasets.
 */
export function toWorkbook(records: DataRecord[], sheetLabel: string): XLSX.WorkBook {
    const workbook = XLSX.utils.book_new();

    if (records.length <= XLSX_MAX_ROWS_PER_SHEET) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), sheetLabel);
        return workbook;
    }

    const chunks = Math.ceil(records.length / XLSX_MAX_ROWS_PER_SHEET);
    console.warn(
        `[format] ${records.length} rows exceed the xlsx sheet limit; splitting into ${chunks} sheets. ` +
        `The .json and .csv copies remain single, complete files.`,
    );

    for (let i = 0; i < chunks; i++) {
        const slice = records.slice(i * XLSX_MAX_ROWS_PER_SHEET, (i + 1) * XLSX_MAX_ROWS_PER_SHEET);
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(slice), `${sheetLabel} (${i + 1})`);
    }

    return workbook;
}
