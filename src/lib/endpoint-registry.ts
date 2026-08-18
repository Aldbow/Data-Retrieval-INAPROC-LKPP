/**
 * Endpoint Registry
 *
 * Single source of truth for every INAPROC/LKPP endpoint this app talks to.
 * Folder mapping, dedup keys, sync eligibility and UI grouping all derive from
 * here, so an endpoint only ever needs to be described once.
 */

/** Which generation of the INAPROC API an endpoint belongs to. */
export type Generation = 'v1' | 'legacy';

/** Top-level UI grouping. Dashboard endpoints are v1 but behave differently. */
export type EndpointGroup = 'data' | 'dashboard';

/**
 * How the payload behaves over time:
 * - dataset   : rows of records, grows per year, deduplicated on sync
 * - aggregate : pre-computed totals; one row per fetch, stored as a snapshot series
 * - reference : slow-moving master/lookup data, not scoped to a year
 */
export type EndpointKind = 'dataset' | 'aggregate' | 'reference';

/**
 * Expected response envelope. Used for documentation and for warning when the
 * API returns something unexpected -- the adapter itself detects structurally,
 * because the envelope is not consistent even within one family
 * (e.g. /dashboard/rup/table wraps in `success`, /dashboard/realisasi/table does not).
 */
export type ResponseShape =
    | 'array'       // [ {...}, {...} ]                     -- legacy endpoints
    | 'data-array'  // { data: [ {...} ], meta }            -- v1 datasets
    | 'items'       // { data: { items: [ {...} ] } }       -- dashboard geo/*
    | 'rows'        // { data: { rows: [ {...} ] } }        -- dashboard table
    | 'object'      // { data: { ...aggregates } }          -- dashboard summary
    | 'nested';     // { data: { data: { ...aggregates } } }-- dashboard precomputed

/**
 * Whether the endpoint can actually be called with the parameters we know:
 * - ready        : callable with tahun/kode_klpd
 * - requires-id  : needs a record identifier (kd_penyedia, kd_komoditas, ...)
 * - needs-params : returns HTTP 400 for every documented parameter combination
 *                  we tried; the required parameter is unknown. Verified
 *                  2026-07-26 against 12 combinations; POST returns 405.
 */
export type EndpointStatus = 'ready' | 'requires-id' | 'needs-params';

/** @see EndpointDef.pagination */
export type PaginationStyle = 'none' | 'cursor' | 'offset';

export interface EndpointDef {
    /** Path appended to the API base URL, e.g. '/v1/rup/master-satker'. */
    value: string;
    label: string;
    generation: Generation;
    group: EndpointGroup;
    /** Sub-group within the generation, used for the second level of UI tabs. */
    category: string;
    kind: EndpointKind;
    shape: ResponseShape;
    status: EndpointStatus;
    /** Sends ?tahun=. Reference and some dashboard endpoints do not. */
    yearScoped: boolean;
    /** Sends ?kode_klpd=. */
    klpdScoped: boolean;
    /**
     * Sends ?jenis=, the KLPD type. Dashboard endpoints only: without it
     * geo/eselon and geo/satker return zero items, and the other families
     * aggregate across every kind of institution at once.
     */
    jenisScoped: boolean;
    /**
     * Sends ?instansi=, the institution filter the dashboard actually honours.
     *
     * ?kode_klpd= does NOT narrow a dashboard response -- probed 2026-07-27, the
     * payload is byte-identical with and without it, and any code other than our
     * own returns nothing, so it reads as an authorisation check on the token.
     * Without ?instansi= the dashboard reports national totals.
     */
    instansiScoped: boolean;
    /**
     * How to ask for the next page:
     * - none   : the response is the whole dataset (legacy, summary, geo)
     * - cursor : follow `meta.cursor` until `has_more` is false (v1 datasets)
     * - offset : advance ?offset= by the page size (dashboard tables)
     *
     * Dashboard tables send no cursor and no meta at all, so treating them as
     * cursor-paginated silently stopped every sync after a single page.
     */
    pagination: PaginationStyle;
    /**
     * Fields forming the natural key, used to skip records already stored.
     * '||' means "first of these that is present", bridging v1/legacy column
     * naming (kode_rup vs kd_rup).
     *
     * Omit when the real key is unknown: the storage layer then falls back to a
     * stable hash of the whole record. That is deliberate -- a WRONG key
     * silently discards distinct records as duplicates (data loss), while no key
     * at worst keeps a duplicate (recoverable). Only fill this in when verified.
     */
    uniqueKeys?: string[];
}

/** Everything after the API base URL is derived from these two prefixes. */
const RUP_PAKET_KEY = ['kode_rup||kd_rup'];
const LELANG_KEY = ['kode_lelang||kd_lelang||kode_rup||kd_rup'];

/**
 * Pencatatan (non-tender / swakelola) is keyed by its own record id, NOT by the
 * RUP package it belongs to: one RUP package is routinely recorded several
 * times, e.g. an attempt that was cancelled plus the one that ran. Verified
 * 2026-08-18 against K34 -- 2026 returns 33 rows over only 23 kd_rup values,
 * and keying on kd_rup dropped 10 of them, including every "Paket Sedang
 * Berjalan". kd_nontender_pct/kd_swakelola_pct is unique per row in every year
 * checked (2024-2026), and both v1 and legacy spell it the same way.
 */
const PENCATATAN_NONTENDER_KEY = ['kd_nontender_pct'];
const PENCATATAN_SWAKELOLA_KEY = ['kd_swakelola_pct'];

type EndpointTraits = Omit<EndpointDef, 'value' | 'label' | 'generation' | 'group' | 'category'>;

/** Defaults for a year-scoped, cursor-paginated v1 dataset. */
const v1Dataset = (uniqueKeys?: string[]): EndpointTraits => ({
    kind: 'dataset',
    shape: 'data-array',
    status: 'ready',
    yearScoped: true,
    klpdScoped: true,
    jenisScoped: false,
    instansiScoped: false,
    pagination: 'cursor',
    uniqueKeys,
});

/** Defaults for a legacy dataset: bare array, no pagination. */
const legacyDataset = (uniqueKeys?: string[]): EndpointTraits => ({
    kind: 'dataset',
    shape: 'array',
    status: 'ready',
    yearScoped: true,
    klpdScoped: true,
    jenisScoped: false,
    instansiScoped: false,
    pagination: 'none',
    uniqueKeys,
});

/** Detail endpoints that need a record id we cannot supply in bulk. */
const detailEndpoint = (generation: Generation): EndpointTraits => ({
    kind: 'dataset',
    shape: generation === 'v1' ? 'data-array' : 'array',
    status: 'requires-id',
    yearScoped: true,
    klpdScoped: true,
    jenisScoped: false,
    instansiScoped: false,
    pagination: generation === 'v1' ? 'cursor' : 'none',
});

/** Dashboard aggregate: a handful of totals, captured as a timestamped snapshot. */
const dashboardAggregate = (shape: ResponseShape, status: EndpointStatus = 'ready'): EndpointTraits => ({
    kind: 'aggregate',
    shape,
    status,
    yearScoped: true,
    klpdScoped: true,
    jenisScoped: true,
    instansiScoped: true,
    pagination: 'none',
});

function def(
    value: string,
    label: string,
    generation: Generation,
    group: EndpointGroup,
    category: string,
    rest: EndpointTraits,
): EndpointDef {
    return { value, label, generation, group, category, ...rest };
}

// ============================================================================
// V1 - DATA
// ============================================================================

const V1_RUP: EndpointDef[] = [
    def('/v1/rup/history-kaji-ulang', 'History Kaji Ulang', 'v1', 'data', 'RUP', v1Dataset()),
    def('/v1/rup/master-satker', 'Master Satker', 'v1', 'data', 'RUP', v1Dataset(['kode_klpd||kd_klpd', 'kode_satker||kd_satker'])),
    def('/v1/rup/paket-anggaran-penyedia', 'Paket Anggaran Penyedia', 'v1', 'data', 'RUP', v1Dataset(RUP_PAKET_KEY)),
    def('/v1/rup/paket-anggaran-swakelola', 'Paket Anggaran Swakelola', 'v1', 'data', 'RUP', v1Dataset(RUP_PAKET_KEY)),
    def('/v1/rup/paket-penyedia', 'Paket Penyedia', 'v1', 'data', 'RUP', v1Dataset(RUP_PAKET_KEY)),
    def('/v1/rup/paket-penyedia-terumumkan', 'Paket Penyedia Terumumkan', 'v1', 'data', 'RUP', v1Dataset(RUP_PAKET_KEY)),
    def('/v1/rup/paket-swakelola', 'Paket Swakelola', 'v1', 'data', 'RUP', v1Dataset(RUP_PAKET_KEY)),
    def('/v1/rup/paket-swakelola-terumumkan', 'Paket Swakelola Terumumkan', 'v1', 'data', 'RUP', v1Dataset(RUP_PAKET_KEY)),
    def('/v1/rup/program-master', 'Program Master', 'v1', 'data', 'RUP', v1Dataset(['kode_program||kd_program'])),
];

const V1_TENDER: EndpointDef[] = [
    def('/v1/tender/jadwal-tahapan-non-tender', 'Jadwal Tahapan Non-Tender', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kode_tahap'])),
    def('/v1/tender/jadwal-tahapan-tender', 'Jadwal Tahapan Tender', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kode_tahap'])),
    def('/v1/tender/non-tender-ekontrak', 'Non-Tender E-Kontrak', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kd_kontrak'])),
    def('/v1/tender/non-tender-ekontrak-kontrak', 'Non-Tender E-Kontrak: Kontrak', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kd_kontrak'])),
    def('/v1/tender/non-tender-pengumuman', 'Non-Tender Pengumuman', 'v1', 'data', 'Tender', v1Dataset(LELANG_KEY)),
    def('/v1/tender/non-tender-selesai', 'Non-Tender Selesai', 'v1', 'data', 'Tender', v1Dataset(LELANG_KEY)),
    def('/v1/tender/pencatatan-non-tender', 'Pencatatan Non-Tender', 'v1', 'data', 'Tender', v1Dataset(PENCATATAN_NONTENDER_KEY)),
    // Realisasi has no verified key: a pencatatan carries several payments, and
    // 2024 returned 212 rows over 146 (kd_nontender_pct, no_realisasi) pairs.
    // The record hash keeps all of them; there is no 'id_realisasi' field.
    def('/v1/tender/pencatatan-non-tender-realisasi', 'Pencatatan Non-Tender Realisasi', 'v1', 'data', 'Tender', v1Dataset()),
    def('/v1/tender/pencatatan-swakelola', 'Pencatatan Swakelola', 'v1', 'data', 'Tender', v1Dataset(PENCATATAN_SWAKELOLA_KEY)),
    def('/v1/tender/pencatatan-swakelola-realisasi', 'Pencatatan Swakelola Realisasi', 'v1', 'data', 'Tender', v1Dataset()),
    def('/v1/tender/pengumuman', 'Pengumuman Tender', 'v1', 'data', 'Tender', v1Dataset(LELANG_KEY)),
    def('/v1/tender/peserta-tender', 'Peserta Tender', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kd_penyedia'])),
    def('/v1/tender/tender-ekontrak', 'Tender E-Kontrak', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kd_kontrak'])),
    def('/v1/tender/tender-ekontrak-kontrak', 'Tender E-Kontrak: Kontrak', 'v1', 'data', 'Tender', v1Dataset([...LELANG_KEY, 'kd_kontrak'])),
    def('/v1/tender/tender-selesai-nilai', 'Tender Selesai (Nilai)', 'v1', 'data', 'Tender', v1Dataset(LELANG_KEY)),
];

const V1_EKATALOG: EndpointDef[] = [
    def('/v1/ekatalog/list-kategori-produk', 'List Kategori Produk', 'v1', 'data', 'E-Katalog', {
        ...v1Dataset(['kd_kategori_1']),
        kind: 'reference',
        yearScoped: false,
        klpdScoped: false,
    }),
    def('/v1/ekatalog/list-produk-penyedia', 'List Produk Penyedia', 'v1', 'data', 'E-Katalog', {
        ...v1Dataset(),
        kind: 'reference',
        yearScoped: false,
        klpdScoped: false,
    }),
    def('/v1/ekatalog/paket-e-purchasing', 'Paket E-Purchasing', 'v1', 'data', 'E-Katalog', v1Dataset(['kd_paket', 'kode_rup||kd_rup'])),
    def('/v1/ekatalog/penyedia-detail', 'Penyedia Detail', 'v1', 'data', 'E-Katalog', detailEndpoint('v1')),
];

const V1_EKATALOG_ARCHIVE: EndpointDef[] = [
    def('/v1/ekatalog-archive/instansi-satker', 'Instansi / Satker', 'v1', 'data', 'E-Katalog Archive', v1Dataset(['kode_klpd||kd_klpd', 'kode_satker||kd_satker'])),
    def('/v1/ekatalog-archive/komoditas-detail', 'Komoditas Detail', 'v1', 'data', 'E-Katalog Archive', detailEndpoint('v1')),
    def('/v1/ekatalog-archive/paket-e-purchasing', 'Paket E-Purchasing', 'v1', 'data', 'E-Katalog Archive', v1Dataset(['kd_paket', 'kode_rup||kd_rup'])),
    def('/v1/ekatalog-archive/penyedia-detail', 'Penyedia Detail', 'v1', 'data', 'E-Katalog Archive', detailEndpoint('v1')),
    def('/v1/ekatalog-archive/penyedia-distributor-detail', 'Penyedia Distributor Detail', 'v1', 'data', 'E-Katalog Archive', detailEndpoint('v1')),
];

// ============================================================================
// V1 - DASHBOARD (aggregates; stored as timestamped snapshot series)
// ============================================================================

/** summary / table / geo triplet shared by most dashboard families. */
function dashboardFamily(slug: string, label: string, extra: EndpointDef[] = []): EndpointDef[] {
    const base = `/v1/dashboard/${slug}`;
    return [
        def(`${base}/summary`, `${label}: Summary`, 'v1', 'dashboard', label, dashboardAggregate('object')),
        def(`${base}/table`, `${label}: Table`, 'v1', 'dashboard', label, {
            ...dashboardAggregate('rows'),
            kind: 'dataset',
            pagination: 'offset',
        }),
        def(`${base}/geo/eselon`, `${label}: Geo Eselon`, 'v1', 'dashboard', label, dashboardAggregate('items')),
        def(`${base}/geo/instansi`, `${label}: Geo Instansi`, 'v1', 'dashboard', label, dashboardAggregate('items')),
        def(`${base}/geo/satker`, `${label}: Geo Satker`, 'v1', 'dashboard', label, dashboardAggregate('items')),
        ...extra,
    ];
}

const V1_DASHBOARD: EndpointDef[] = [
    def('/v1/dashboard/last-update', 'Last Update', 'v1', 'dashboard', 'Umum', {
        // A global freshness timestamp: not scoped to a year or an institution.
        ...dashboardAggregate('object'),
        yearScoped: false,
        klpdScoped: false,
        jenisScoped: false,
        instansiScoped: false,
    }),
    ...dashboardFamily('rup', 'RUP', [
        def('/v1/dashboard/rup/detail', 'RUP: Detail', 'v1', 'dashboard', 'RUP', dashboardAggregate('rows', 'needs-params')),
    ]),
    ...dashboardFamily('realisasi', 'Realisasi', [
        def('/v1/dashboard/realisasi/detail/paket', 'Realisasi: Detail Paket', 'v1', 'dashboard', 'Realisasi', dashboardAggregate('rows', 'needs-params')),
        def('/v1/dashboard/realisasi/detail/jadwal', 'Realisasi: Detail Jadwal', 'v1', 'dashboard', 'Realisasi', dashboardAggregate('rows', 'needs-params')),
        def('/v1/dashboard/realisasi/filters/status-paket', 'Realisasi: Filter Status Paket', 'v1', 'dashboard', 'Realisasi', dashboardAggregate('items', 'needs-params')),
    ]),
    ...dashboardFamily('pembayaran', 'Pembayaran'),
    ...dashboardFamily('afirmasi', 'Afirmasi'),
    ...dashboardFamily('profil', 'Profil', [
        def('/v1/dashboard/profil/precomputed', 'Profil: Precomputed', 'v1', 'dashboard', 'Profil', dashboardAggregate('nested')),
    ]),
];

// ============================================================================
// LEGACY
// ============================================================================

const LEGACY_RUP: EndpointDef[] = [
    def('/legacy/rup/kegiatan-master', 'Kegiatan Master', 'legacy', 'data', 'RUP', legacyDataset(['kd_kegiatan'])),
    def('/legacy/rup/master-satker', 'Master Satker', 'legacy', 'data', 'RUP', legacyDataset(['kode_klpd||kd_klpd', 'kode_satker||kd_satker'])),
    def('/legacy/rup/paket-anggaran-penyedia', 'Paket Anggaran Penyedia', 'legacy', 'data', 'RUP', legacyDataset(RUP_PAKET_KEY)),
    def('/legacy/rup/paket-anggaran-swakelola', 'Paket Anggaran Swakelola', 'legacy', 'data', 'RUP', legacyDataset(RUP_PAKET_KEY)),
    def('/legacy/rup/paket-penyedia-lokasi', 'Paket Penyedia Lokasi', 'legacy', 'data', 'RUP', legacyDataset()),
    def('/legacy/rup/paket-penyedia-terumumkan', 'Paket Penyedia Terumumkan', 'legacy', 'data', 'RUP', legacyDataset(RUP_PAKET_KEY)),
    def('/legacy/rup/paket-swakelola-lokasi', 'Paket Swakelola Lokasi', 'legacy', 'data', 'RUP', legacyDataset()),
    def('/legacy/rup/paket-swakelola-terumumkan', 'Paket Swakelola Terumumkan', 'legacy', 'data', 'RUP', legacyDataset(RUP_PAKET_KEY)),
    def('/legacy/rup/program-master', 'Program Master', 'legacy', 'data', 'RUP', legacyDataset(['kode_program||kd_program'])),
    def('/legacy/rup/struktur-anggaran-pd', 'Struktur Anggaran PD', 'legacy', 'data', 'RUP', legacyDataset()),
    def('/legacy/rup/sub-kegiatan-master', 'Sub Kegiatan Master', 'legacy', 'data', 'RUP', legacyDataset()),
];

const LEGACY_TENDER: EndpointDef[] = [
    def('/legacy/tender/jadwal-tahapan-non-tender', 'Jadwal Tahapan Non-Tender', 'legacy', 'data', 'Tender', legacyDataset([...LELANG_KEY, 'kode_tahap'])),
    def('/legacy/tender/jadwal-tahapan-tender', 'Jadwal Tahapan Tender', 'legacy', 'data', 'Tender', legacyDataset([...LELANG_KEY, 'kode_tahap'])),
    def('/legacy/tender/non-tender-ekontrak-bapbast', 'Non-Tender E-Kontrak: BAPBAST', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/non-tender-ekontrak-kontrak', 'Non-Tender E-Kontrak: Kontrak', 'legacy', 'data', 'Tender', legacyDataset([...LELANG_KEY, 'kd_kontrak'])),
    def('/legacy/tender/non-tender-ekontrak-spmkspp', 'Non-Tender E-Kontrak: SPMK/SPP', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/non-tender-ekontrak-sppbj', 'Non-Tender E-Kontrak: SPPBJ', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/non-tender-pengumuman', 'Non-Tender Pengumuman', 'legacy', 'data', 'Tender', legacyDataset(LELANG_KEY)),
    def('/legacy/tender/non-tender-selesai', 'Non-Tender Selesai', 'legacy', 'data', 'Tender', legacyDataset(LELANG_KEY)),
    def('/legacy/tender/pencatatan-non-tender', 'Pencatatan Non-Tender', 'legacy', 'data', 'Tender', legacyDataset(PENCATATAN_NONTENDER_KEY)),
    def('/legacy/tender/pencatatan-non-tender-realisasi', 'Pencatatan Non-Tender Realisasi', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/pencatatan-swakelola', 'Pencatatan Swakelola', 'legacy', 'data', 'Tender', legacyDataset(PENCATATAN_SWAKELOLA_KEY)),
    def('/legacy/tender/pencatatan-swakelola-realisasi', 'Pencatatan Swakelola Realisasi', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/pengumuman', 'Pengumuman Tender', 'legacy', 'data', 'Tender', legacyDataset(LELANG_KEY)),
    def('/legacy/tender/peserta-tender', 'Peserta Tender', 'legacy', 'data', 'Tender', legacyDataset([...LELANG_KEY, 'kd_penyedia'])),
    def('/legacy/tender/tender-ekontrak-bapbast', 'Tender E-Kontrak: BAPBAST', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/tender-ekontrak-kontrak', 'Tender E-Kontrak: Kontrak', 'legacy', 'data', 'Tender', legacyDataset([...LELANG_KEY, 'kd_kontrak'])),
    def('/legacy/tender/tender-ekontrak-spmkspp', 'Tender E-Kontrak: SPMK/SPP', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/tender-ekontrak-sppbj', 'Tender E-Kontrak: SPPBJ', 'legacy', 'data', 'Tender', legacyDataset()),
    def('/legacy/tender/tender-selesai', 'Tender Selesai', 'legacy', 'data', 'Tender', legacyDataset(LELANG_KEY)),
    def('/legacy/tender/tender-selesai-nilai', 'Tender Selesai (Nilai)', 'legacy', 'data', 'Tender', legacyDataset(LELANG_KEY)),
];

const LEGACY_EKATALOG: EndpointDef[] = [
    def('/legacy/ekatalog/paket-e-purchasing', 'Paket E-Purchasing', 'legacy', 'data', 'E-Katalog', legacyDataset(['kd_paket', 'kode_rup||kd_rup'])),
    def('/legacy/ekatalog/penyedia-detail', 'Penyedia Detail', 'legacy', 'data', 'E-Katalog', detailEndpoint('legacy')),
];

const LEGACY_EKATALOG_ARCHIVE: EndpointDef[] = [
    def('/legacy/ekatalog-archive/instansi-satker', 'Instansi / Satker', 'legacy', 'data', 'E-Katalog Archive', legacyDataset(['kode_klpd||kd_klpd', 'kode_satker||kd_satker'])),
    def('/legacy/ekatalog-archive/komoditas-detail', 'Komoditas Detail', 'legacy', 'data', 'E-Katalog Archive', detailEndpoint('legacy')),
    def('/legacy/ekatalog-archive/paket-e-purchasing', 'Paket E-Purchasing', 'legacy', 'data', 'E-Katalog Archive', legacyDataset(['kd_paket', 'kode_rup||kd_rup'])),
    def('/legacy/ekatalog-archive/penyedia-detail', 'Penyedia Detail', 'legacy', 'data', 'E-Katalog Archive', detailEndpoint('legacy')),
    def('/legacy/ekatalog-archive/penyedia-distributor-detail', 'Penyedia Distributor Detail', 'legacy', 'data', 'E-Katalog Archive', detailEndpoint('legacy')),
];

const LEGACY_BELA: EndpointDef[] = [
    def('/legacy/bela/toko-daring-realisasi', 'Toko Daring Realisasi', 'legacy', 'data', 'Bela Pengadaan', legacyDataset([...RUP_PAKET_KEY, 'id_realisasi'])),
];

// ============================================================================
// PUBLIC API
// ============================================================================

export const ENDPOINTS: EndpointDef[] = [
    ...V1_RUP,
    ...V1_TENDER,
    ...V1_EKATALOG,
    ...V1_EKATALOG_ARCHIVE,
    ...V1_DASHBOARD,
    ...LEGACY_RUP,
    ...LEGACY_TENDER,
    ...LEGACY_EKATALOG,
    ...LEGACY_EKATALOG_ARCHIVE,
    ...LEGACY_BELA,
];

const BY_VALUE = new Map(ENDPOINTS.map((ep) => [ep.value, ep]));

/** Look up an endpoint definition. Returns undefined for unknown paths. */
export function getEndpoint(value: string): EndpointDef | undefined {
    return BY_VALUE.get(value);
}

/**
 * Whether a caller-supplied endpoint path is one we serve. This is the
 * whitelist that request handlers must use -- prefix checks are not enough,
 * because everything after the prefix used to be forwarded to the upstream API
 * verbatim.
 */
export function isKnownEndpoint(value: string): boolean {
    return BY_VALUE.has(value);
}

/** Endpoints that can be synced in bulk without extra identifiers. */
export function getSyncableEndpoints(): EndpointDef[] {
    return ENDPOINTS.filter((ep) => ep.status === 'ready');
}

/** Endpoints eligible for multi-year range sync: year-scoped datasets only. */
export function getRangeSyncableEndpoints(): EndpointDef[] {
    return ENDPOINTS.filter((ep) => ep.status === 'ready' && ep.yearScoped && ep.kind !== 'aggregate');
}

export function isLegacyEndpoint(value: string): boolean {
    return value.startsWith('/legacy/');
}

/**
 * Dedup key fields, or undefined when unknown (caller should hash the record).
 * @see EndpointDef.uniqueKeys for why guessing is avoided.
 */
export function getUniqueKeyFields(value: string): string[] | undefined {
    return BY_VALUE.get(value)?.uniqueKeys;
}

export interface EndpointTree {
    group: EndpointGroup;
    generation: Generation;
    /** Label for the first-level tab, e.g. 'V1 · Data'. */
    title: string;
    categories: { name: string; endpoints: EndpointDef[] }[];
    count: number;
}

/**
 * Endpoints arranged for the two-level UI navigation:
 * V1 · Data / V1 · Dashboard / Legacy, each split by category.
 */
export function getEndpointTree(): EndpointTree[] {
    const sections: { group: EndpointGroup; generation: Generation; title: string }[] = [
        { group: 'data', generation: 'v1', title: 'V1 · Data' },
        { group: 'dashboard', generation: 'v1', title: 'V1 · Dashboard' },
        { group: 'data', generation: 'legacy', title: 'Legacy' },
    ];

    return sections.map(({ group, generation, title }) => {
        const members = ENDPOINTS.filter((ep) => ep.group === group && ep.generation === generation);
        const byCategory = new Map<string, EndpointDef[]>();

        for (const ep of members) {
            const bucket = byCategory.get(ep.category);
            if (bucket) bucket.push(ep);
            else byCategory.set(ep.category, [ep]);
        }

        return {
            group,
            generation,
            title,
            categories: Array.from(byCategory, ([name, endpoints]) => ({ name, endpoints })),
            count: members.length,
        };
    });
}
