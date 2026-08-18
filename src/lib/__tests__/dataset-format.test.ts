import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recordKey, toCsv } from '../dataset-format.ts';

describe('recordKey', () => {
    it('joins the configured key fields', () => {
        const key = recordKey({ kode_rup: 'A', kode_tahap: '1' }, ['kode_rup', 'kode_tahap']);
        assert.equal(key, 'A|1');
    });

    it('falls back through || alternatives, bridging v1 and legacy names', () => {
        const v1 = recordKey({ kode_rup: 'A' }, ['kode_rup||kd_rup']);
        const legacy = recordKey({ kd_rup: 'A' }, ['kode_rup||kd_rup']);

        assert.equal(v1, 'A');
        assert.equal(legacy, 'A', 'both spellings must produce the same identity');
    });

    it('skips blank alternatives', () => {
        const key = recordKey({ kode_rup: '   ', kd_rup: 'B' }, ['kode_rup||kd_rup']);
        assert.equal(key, 'B');
    });

    it('treats 0 and false as real values, not blanks', () => {
        assert.equal(recordKey({ id: 0 }, ['id']), '0');
        assert.equal(recordKey({ flag: false }, ['flag']), 'false');
    });

    describe('hash fallback', () => {
        it('hashes the record when no key fields are configured', () => {
            const key = recordKey({ a: 1, b: 2 }, undefined);
            assert.match(key, /^#[0-9a-f]{40}$/);
        });

        it('hashes the record when every key field is empty', () => {
            const key = recordKey({ kode_rup: '', other: 'x' }, ['kode_rup']);
            assert.match(key, /^#[0-9a-f]{40}$/);
        });

        // The old fallback hashed JSON.stringify(record) directly, so the same
        // record with reordered properties produced a different key and was
        // re-appended on every sync.
        it('is independent of property order', () => {
            const a = recordKey({ x: 1, y: 2, z: 3 }, null);
            const b = recordKey({ z: 3, x: 1, y: 2 }, null);

            assert.equal(a, b);
        });

        it('distinguishes genuinely different records', () => {
            assert.notEqual(recordKey({ a: 1 }, null), recordKey({ a: 2 }, null));
        });

        it('ignores the snapshot stamp so identical captures still match', () => {
            const a = recordKey({ total: 5, _snapshot_at: '2026-01-01T00:00:00Z' }, null);
            const b = recordKey({ total: 5, _snapshot_at: '2026-07-26T00:00:00Z' }, null);

            assert.equal(a, b);
        });
    });
});

describe('toCsv', () => {
    it('returns an empty string for no records', () => {
        assert.equal(toCsv([]), '');
    });

    it('writes a header from the union of all columns', () => {
        const csv = toCsv([{ a: 1 }, { b: 2 }]);
        const [header] = csv.split('\r\n');

        assert.equal(header, 'a,b');
    });

    it('leaves cells blank where a record lacks the column', () => {
        const csv = toCsv([{ a: 1 }, { b: 2 }]);
        const lines = csv.trim().split('\r\n');

        assert.equal(lines[1], '1,');
        assert.equal(lines[2], ',2');
    });

    it('quotes and escapes commas, quotes and newlines', () => {
        const csv = toCsv([{ text: 'Jl. MT Haryono, Kav. 52' }]);
        assert.ok(csv.includes('"Jl. MT Haryono, Kav. 52"'));

        const quoted = toCsv([{ text: 'she said "hi"' }]);
        assert.ok(quoted.includes('"she said ""hi"""'));

        const multiline = toCsv([{ text: 'line1\nline2' }]);
        assert.ok(multiline.includes('"line1\nline2"'));
    });

    it('writes null and undefined as empty cells', () => {
        const csv = toCsv([{ a: null, b: undefined, c: 'x' }]);
        const lines = csv.trim().split('\r\n');

        assert.equal(lines[0], 'a,b,c');
        assert.equal(lines[1], ',,x');
    });

    it('serialises nested objects as JSON', () => {
        const csv = toCsv([{ nested: { deep: 1 } }]);
        assert.ok(csv.includes('"{""deep"":1}"'));
    });

    it('ends with a line break', () => {
        assert.ok(toCsv([{ a: 1 }]).endsWith('\r\n'));
    });
});
