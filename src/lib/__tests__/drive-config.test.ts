import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import {
    DATA_ROOT,
    isValidYear,
    assertValidYear,
    resolveWithin,
    getDatasetPaths,
    UnsafePathError,
} from '../drive-config.ts';

describe('isValidYear', () => {
    it('accepts four-digit years in range', () => {
        for (const year of ['2000', '2025', '2026', '2100']) {
            assert.equal(isValidYear(year), true, year);
        }
    });

    it('rejects anything that is not a plain in-range year', () => {
        const rejected = [
            '1999',
            '2101',
            '25',
            '20255',
            '',
            ' 2025',
            '2025 ',
            '2o25',
            '../2025',
            null,
            undefined,
            2025, // number, not string
        ];

        for (const value of rejected) {
            assert.equal(isValidYear(value), false, String(value));
        }
    });

    // The year becomes part of a filename, so a traversal payload here used to
    // mean an arbitrary file write, and an arbitrary delete via forceOverwrite.
    it('rejects traversal payloads', () => {
        const payloads = [
            '../../../../etc/passwd',
            '..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts',
            '2025/../../secret',
            '%2e%2e%2f2025',
        ];

        for (const payload of payloads) {
            assert.equal(isValidYear(payload), false, payload);
            assert.throws(() => assertValidYear(payload), UnsafePathError);
        }
    });
});

describe('resolveWithin', () => {
    it('joins ordinary segments', () => {
        const result = resolveWithin(DATA_ROOT, 'v1', 'rup');
        assert.equal(result, path.join(DATA_ROOT, 'v1', 'rup'));
    });

    it('refuses to escape the base directory', () => {
        assert.throws(() => resolveWithin(DATA_ROOT, '..'), UnsafePathError);
        assert.throws(() => resolveWithin(DATA_ROOT, '..', '..', 'Windows'), UnsafePathError);
        assert.throws(() => resolveWithin(DATA_ROOT, 'v1', '..', '..', 'outside'), UnsafePathError);
    });

    it('refuses an absolute path that lands outside the base', () => {
        assert.throws(() => resolveWithin(DATA_ROOT, 'C:\\Windows\\System32'), UnsafePathError);
    });

    it('allows a path that stays inside after normalisation', () => {
        const result = resolveWithin(DATA_ROOT, 'v1', 'rup', '..', 'tender');
        assert.equal(result, path.join(DATA_ROOT, 'v1', 'tender'));
    });
});

describe('getDatasetPaths', () => {
    it('puts all three formats side by side under the same stem', () => {
        const paths = getDatasetPaths('/v1/rup/master-satker', '2025');

        assert.equal(paths.stem, 'master-satker_2025');
        assert.equal(paths.dir, path.join(DATA_ROOT, 'v1', 'rup'));
        assert.equal(paths.json, path.join(paths.dir, 'master-satker_2025.json'));
        assert.equal(paths.csv, path.join(paths.dir, 'master-satker_2025.csv'));
        assert.equal(paths.xlsx, path.join(paths.dir, 'master-satker_2025.xlsx'));
        assert.equal(paths.meta, path.join(paths.dir, 'master-satker_2025.meta.json'));
    });

    it('mirrors deep dashboard paths as directories', () => {
        const paths = getDatasetPaths('/v1/dashboard/realisasi/geo/satker', '2025');

        assert.equal(paths.dir, path.join(DATA_ROOT, 'v1', 'dashboard', 'realisasi', 'geo'));
        assert.equal(paths.stem, 'satker_2025');
    });

    it('omits the year for endpoints that are not year-scoped', () => {
        const paths = getDatasetPaths('/v1/dashboard/last-update');

        assert.equal(paths.stem, 'last-update');
        assert.equal(paths.json, path.join(DATA_ROOT, 'v1', 'dashboard', 'last-update.json'));
    });

    it('rejects an invalid year', () => {
        assert.throws(() => getDatasetPaths('/v1/rup/master-satker', '../../evil'), UnsafePathError);
        assert.throws(() => getDatasetPaths('/v1/rup/master-satker', '25'), UnsafePathError);
    });

    it('rejects endpoint segments that are not plain slugs', () => {
        const bad = [
            '/v1/rup/../../../etc',
            '/v1/rup/..',
            '/v1/RUP/master',      // uppercase
            '/v1/rup/mas ter',     // space
            '/v1/rup/master$',     // symbol
            '/single',             // too few segments
        ];

        for (const endpoint of bad) {
            assert.throws(() => getDatasetPaths(endpoint, '2025'), UnsafePathError, endpoint);
        }
    });
});
