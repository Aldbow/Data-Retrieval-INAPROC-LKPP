import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ENDPOINTS,
    getEndpoint,
    isKnownEndpoint,
    getSyncableEndpoints,
    getRangeSyncableEndpoints,
    getEndpointTree,
    getUniqueKeyFields,
} from '../endpoint-registry.ts';

/** Endpoint count agreed with the requested list. */
const EXPECTED_TOTAL = 103;

describe('registry contents', () => {
    it('holds every requested endpoint', () => {
        assert.equal(ENDPOINTS.length, EXPECTED_TOTAL);
    });

    it('has no duplicate paths', () => {
        const seen = new Set(ENDPOINTS.map((ep) => ep.value));
        assert.equal(seen.size, ENDPOINTS.length);
    });

    it('only contains v1 and legacy paths', () => {
        for (const ep of ENDPOINTS) {
            assert.ok(
                ep.value.startsWith('/v1/') || ep.value.startsWith('/legacy/'),
                `${ep.value} has an unexpected prefix`,
            );
        }
    });

    it('agrees with itself about generation and path prefix', () => {
        for (const ep of ENDPOINTS) {
            const expected = ep.value.startsWith('/legacy/') ? 'legacy' : 'v1';
            assert.equal(ep.generation, expected, ep.value);
        }
    });

    it('marks only v1 dashboard endpoints as the dashboard group', () => {
        for (const ep of ENDPOINTS) {
            const isDashboardPath = ep.value.startsWith('/v1/dashboard/');
            assert.equal(ep.group === 'dashboard', isDashboardPath, ep.value);
        }
    });

    it('never paginates legacy endpoints, which return everything at once', () => {
        for (const ep of ENDPOINTS.filter((e) => e.generation === 'legacy')) {
            assert.equal(ep.paginated, false, ep.value);
        }
    });

    // ?jenis= selects the KLPD type. Probed 2026-07-27: dropping it makes
    // geo/eselon and geo/satker return zero items, and makes summary/table
    // aggregate across ministries, agencies and regions at once.
    it('sends jenis on dashboard endpoints and nowhere else', () => {
        for (const ep of ENDPOINTS) {
            const expected = ep.group === 'dashboard' && ep.value !== '/v1/dashboard/last-update';
            assert.equal(ep.jenisScoped, expected, ep.value);
        }
    });

    // last-update is a global freshness timestamp; scoping it to one KLPD type
    // would silently narrow what the UI reports as "data as of".
    it('leaves last-update unscoped', () => {
        const ep = getEndpoint('/v1/dashboard/last-update')!;
        assert.equal(ep.yearScoped, false);
        assert.equal(ep.klpdScoped, false);
        assert.equal(ep.jenisScoped, false);
    });

    it('never sends jenis without kode_klpd, which the API pairs it with', () => {
        for (const ep of ENDPOINTS) {
            if (ep.jenisScoped) assert.equal(ep.klpdScoped, true, ep.value);
        }
    });

    // ?instansi= is what actually narrows a dashboard response to one
    // institution; ?kode_klpd= only authorises. Sending jenis without instansi
    // would report every ministry at once, which is what this guards against.
    it('sends instansi wherever it sends jenis', () => {
        for (const ep of ENDPOINTS) {
            assert.equal(ep.instansiScoped, ep.jenisScoped, ep.value);
        }
    });

    it('gives every endpoint a non-empty label and category', () => {
        for (const ep of ENDPOINTS) {
            assert.ok(ep.label.trim().length > 0, ep.value);
            assert.ok(ep.category.trim().length > 0, ep.value);
        }
    });
});

describe('lookup', () => {
    it('finds a known endpoint', () => {
        assert.equal(getEndpoint('/v1/rup/master-satker')?.category, 'RUP');
        assert.equal(isKnownEndpoint('/v1/rup/master-satker'), true);
    });

    // This whitelist replaced a prefix check that forwarded whatever followed
    // the prefix straight to the upstream API.
    it('rejects paths that merely share a prefix', () => {
        const attempts = [
            '/v1/rup/master-satker/../../admin',
            '/v1/rup/does-not-exist',
            '/v1/',
            '/legacy/anything',
            '',
            '/v1/rup/master-satker ',
        ];

        for (const attempt of attempts) {
            assert.equal(isKnownEndpoint(attempt), false, attempt);
            assert.equal(getEndpoint(attempt), undefined, attempt);
        }
    });
});

describe('sync eligibility', () => {
    it('excludes endpoints that need an id or unknown parameters', () => {
        for (const ep of getSyncableEndpoints()) {
            assert.equal(ep.status, 'ready', ep.value);
        }
    });

    it('excludes aggregates and non-year endpoints from range sync', () => {
        for (const ep of getRangeSyncableEndpoints()) {
            assert.equal(ep.status, 'ready', ep.value);
            assert.equal(ep.yearScoped, true, ep.value);
            assert.notEqual(ep.kind, 'aggregate', ep.value);
        }
    });

    it('keeps the four probe-confirmed needs-params endpoints out of sync', () => {
        const blocked = ENDPOINTS.filter((ep) => ep.status === 'needs-params').map((ep) => ep.value);

        assert.deepEqual(blocked.sort(), [
            '/v1/dashboard/realisasi/detail/jadwal',
            '/v1/dashboard/realisasi/detail/paket',
            '/v1/dashboard/realisasi/filters/status-paket',
            '/v1/dashboard/rup/detail',
        ]);
    });
});

describe('unique keys', () => {
    it('returns undefined rather than guessing when the key is unknown', () => {
        assert.equal(getUniqueKeyFields('/legacy/tender/tender-ekontrak-sppbj'), undefined);
    });

    it('returns the configured key where it is known', () => {
        assert.deepEqual(getUniqueKeyFields('/v1/rup/paket-penyedia-terumumkan'), ['kode_rup||kd_rup']);
    });

    it('never configures an empty key array, which would defeat dedup', () => {
        for (const ep of ENDPOINTS) {
            if (ep.uniqueKeys !== undefined) {
                assert.ok(ep.uniqueKeys.length > 0, ep.value);
            }
        }
    });
});

describe('getEndpointTree', () => {
    it('covers every endpoint exactly once across the three sections', () => {
        const tree = getEndpointTree();
        const flattened = tree.flatMap((s) => s.categories.flatMap((c) => c.endpoints.map((e) => e.value)));

        assert.equal(flattened.length, EXPECTED_TOTAL);
        assert.equal(new Set(flattened).size, EXPECTED_TOTAL);
    });

    it('reports a count matching its own contents', () => {
        for (const section of getEndpointTree()) {
            const actual = section.categories.reduce((sum, c) => sum + c.endpoints.length, 0);
            assert.equal(section.count, actual, section.title);
        }
    });

    it('exposes the three expected sections', () => {
        assert.deepEqual(
            getEndpointTree().map((s) => s.title),
            ['V1 · Data', 'V1 · Dashboard', 'Legacy'],
        );
    });

    // The Sync Manager renders one section at a time and falls back to "all
    // categories" when the selected one is absent. That fallback only saves it
    // if every section has something to show.
    it('never produces an empty section or category', () => {
        for (const section of getEndpointTree()) {
            assert.ok(section.categories.length > 0, `${section.title} has no categories`);

            for (const category of section.categories) {
                assert.ok(
                    category.endpoints.length > 0,
                    `${section.title} / ${category.name} is empty`,
                );
            }
        }
    });

    it('keeps each section self-contained, so a category never spans sections', () => {
        for (const section of getEndpointTree()) {
            for (const category of section.categories) {
                for (const ep of category.endpoints) {
                    assert.equal(ep.category, category.name, ep.value);
                }
            }
        }
    });
});
