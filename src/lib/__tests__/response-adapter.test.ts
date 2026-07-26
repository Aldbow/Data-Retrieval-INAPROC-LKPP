import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptResponse } from '../response-adapter.ts';

describe('adaptResponse', () => {
    it('reads a bare array (legacy endpoints)', () => {
        const result = adaptResponse([{ kd_rup: 1 }, { kd_rup: 2 }]);

        assert.equal(result.detectedShape, 'array');
        assert.equal(result.rows.length, 2);
        assert.equal(result.hasMore, false);
        assert.equal(result.cursor, null);
    });

    it('reads { data: [...] } (v1 datasets)', () => {
        const result = adaptResponse({ data: [{ kode_rup: 'A' }], meta: { limit: 1 } });

        assert.equal(result.detectedShape, 'data-array');
        assert.deepEqual(result.rows, [{ kode_rup: 'A' }]);
    });

    it('reads { data: { items: [] } } (dashboard geo)', () => {
        const result = adaptResponse({ success: true, data: { items: [{ nama: 'X' }] } });

        assert.equal(result.detectedShape, 'items');
        assert.equal(result.rows.length, 1);
    });

    it('reads { data: { rows: [] } } (dashboard table)', () => {
        const result = adaptResponse({ data: { rows: [{ total_nilai: 12000 }] } });

        assert.equal(result.detectedShape, 'rows');
        assert.equal(result.rows[0].total_nilai, 12000);
    });

    it('turns an aggregate object into a single row', () => {
        const result = adaptResponse({ success: true, data: { jumlah_rup: 5, total_pagu: 100 } });

        assert.equal(result.detectedShape, 'object');
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].jumlah_rup, 5);
    });

    it('unwraps the doubly-nested precomputed payload', () => {
        const result = adaptResponse({ success: true, data: { data: { pdn: 3955712 } } });

        assert.equal(result.detectedShape, 'nested');
        assert.deepEqual(result.rows, [{ pdn: 3955712 }]);
    });

    it('treats data: null as empty rather than an error', () => {
        const result = adaptResponse({ success: true, data: null, meta: { limit: 1 } });

        assert.deepEqual(result.rows, []);
        assert.equal(result.apiError, null);
    });

    it('surfaces a business-level rejection without throwing', () => {
        const result = adaptResponse({
            success: false,
            data: {},
            error: { code: '1004', message: 'Permintaan tidak valid' },
        });

        assert.equal(result.apiError?.code, '1004');
        assert.deepEqual(result.rows, []);
        assert.equal(result.hasMore, false);
    });

    describe('pagination', () => {
        it('reads the cursor out of meta', () => {
            const result = adaptResponse({ data: [{ a: 1 }], meta: { cursor: 'abc', has_more: true } });

            assert.equal(result.cursor, 'abc');
            assert.equal(result.hasMore, true);
        });

        // The flag lives in meta.has_more. Reading the top level made the check
        // vacuous (undefined !== false), so an endpoint saying "no more" was
        // ignored and only a missing cursor ended pagination.
        it('honours meta.has_more: false even when a cursor is present', () => {
            const result = adaptResponse({ data: [{ a: 1 }], meta: { cursor: 'abc', has_more: false } });

            assert.equal(result.cursor, 'abc');
            assert.equal(result.hasMore, false);
        });

        it('cannot continue without a cursor, whatever has_more says', () => {
            const result = adaptResponse({ data: [{ a: 1 }], meta: { has_more: true } });

            assert.equal(result.cursor, null);
            assert.equal(result.hasMore, false);
        });

        it('assumes more data when a cursor exists and no flag is given', () => {
            const result = adaptResponse({ data: [{ a: 1 }], cursor: 'top-level' });

            assert.equal(result.cursor, 'top-level');
            assert.equal(result.hasMore, true);
        });
    });

    it('stamps every row with the snapshot time when asked', () => {
        const at = '2026-07-26T09:00:00.000Z';
        const result = adaptResponse({ data: { items: [{ a: 1 }, { a: 2 }] } }, { snapshotAt: at });

        assert.equal(result.rows.length, 2);
        assert.ok(result.rows.every((row) => row._snapshot_at === at));
    });

    it('ignores non-object entries inside a row array', () => {
        const result = adaptResponse([{ ok: true }, null, 'junk', 42]);

        assert.equal(result.rows.length, 1);
    });
});
