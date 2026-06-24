
export interface Endpoint {
    label: string;
    value: string;
    type: 'v1' | 'legacy';
    /** If true, this endpoint requires additional parameters (like kd_distributor) and cannot be synced */
    requiresId?: boolean;
}

export const ENDPOINTS: Endpoint[] = [
    // ==================== V1 ENDPOINTS ====================
    // E-Katalog Archive
    { label: "Paket E-Purchasing (Archive)", value: "/v1/ekatalog-archive/paket-e-purchasing", type: "v1" },
    { label: "Instansi / Satker (Archive)", value: "/v1/ekatalog-archive/instansi-satker", type: "v1" },
    { label: "Komoditas Detail (Archive)", value: "/v1/ekatalog-archive/komoditas-detail", type: "v1", requiresId: true },
    { label: "Penyedia Detail (Archive)", value: "/v1/ekatalog-archive/penyedia-detail", type: "v1", requiresId: true },
    { label: "Penyedia Distributor Detail (Archive)", value: "/v1/ekatalog-archive/penyedia-distributor-detail", type: "v1", requiresId: true },
    // E-Katalog Live
    { label: "Paket E-Purchasing (Live)", value: "/v1/ekatalog/paket-e-purchasing", type: "v1" },
    { label: "Penyedia Detail (Live)", value: "/v1/ekatalog/penyedia-detail", type: "v1", requiresId: true },
    // RUP
    { label: "RUP History Kaji Ulang", value: "/v1/rup/history-kaji-ulang", type: "v1" },
    { label: "RUP Master Satker", value: "/v1/rup/master-satker", type: "v1" },
    { label: "RUP Paket Anggaran Penyedia", value: "/v1/rup/paket-anggaran-penyedia", type: "v1" },
    { label: "RUP Paket Anggaran Swakelola", value: "/v1/rup/paket-anggaran-swakelola", type: "v1" },
    { label: "RUP Paket Penyedia Terumumkan", value: "/v1/rup/paket-penyedia-terumumkan", type: "v1" },
    { label: "RUP Paket Swakelola Terumumkan", value: "/v1/rup/paket-swakelola-terumumkan", type: "v1" },
    { label: "RUP Program Master", value: "/v1/rup/program-master", type: "v1" },
    // Tender
    { label: "Tender: Jadwal Tahapan Non-Tender", value: "/v1/tender/jadwal-tahapan-non-tender", type: "v1" },
    { label: "Tender: Jadwal Tahapan Tender", value: "/v1/tender/jadwal-tahapan-tender", type: "v1" },
    { label: "Tender: Non-Tender Ekontrak Kontrak", value: "/v1/tender/non-tender-ekontrak-kontrak", type: "v1" },
    { label: "Tender: Non-Tender Ekontrak", value: "/v1/tender/non-tender-ekontrak", type: "v1" },
    { label: "Tender: Non-Tender Pengumuman", value: "/v1/tender/non-tender-pengumuman", type: "v1" },
    { label: "Tender: Non-Tender Selesai", value: "/v1/tender/non-tender-selesai", type: "v1" },
    { label: "Tender: Pencatatan Non-Tender", value: "/v1/tender/pencatatan-non-tender", type: "v1" },
    { label: "Tender: Pencatatan Non-Tender Realisasi", value: "/v1/tender/pencatatan-non-tender-realisasi", type: "v1" },
    { label: "Tender: Pencatatan Swakelola", value: "/v1/tender/pencatatan-swakelola", type: "v1" },
    { label: "Tender: Pencatatan Swakelola Realisasi", value: "/v1/tender/pencatatan-swakelola-realisasi", type: "v1" },
    { label: "Tender: Pengumuman", value: "/v1/tender/pengumuman", type: "v1" },
    { label: "Tender: Peserta Tender", value: "/v1/tender/peserta-tender", type: "v1" },
    { label: "Tender: Tender Ekontrak Kontrak", value: "/v1/tender/tender-ekontrak-kontrak", type: "v1" },
    { label: "Tender: Tender Ekontrak", value: "/v1/tender/tender-ekontrak", type: "v1" },
    { label: "Tender: Tender Selesai Nilai", value: "/v1/tender/tender-selesai-nilai", type: "v1" },

    // ==================== LEGACY ENDPOINTS ====================
    // Legacy Tender
    { label: "Legacy: Jadwal Tahapan Non-Tender", value: "/legacy/tender/jadwal-tahapan-non-tender", type: "legacy" },
    { label: "Legacy: Non-Tender Ekontrak Kontrak", value: "/legacy/tender/non-tender-ekontrak-kontrak", type: "legacy" },
    { label: "Legacy: Non-Tender Selesai", value: "/legacy/tender/non-tender-selesai", type: "legacy" },
    { label: "Legacy: Pencatatan Non-Tender Realisasi", value: "/legacy/tender/pencatatan-non-tender-realisasi", type: "legacy" },
    { label: "Legacy: Pencatatan Swakelola Realisasi", value: "/legacy/tender/pencatatan-swakelola-realisasi", type: "legacy" },
    { label: "Legacy: Peserta Tender", value: "/legacy/tender/peserta-tender", type: "legacy" },
    { label: "Legacy: Tender Selesai Nilai", value: "/legacy/tender/tender-selesai-nilai", type: "legacy" },
    { label: "Legacy: Jadwal Tahapan Tender", value: "/legacy/tender/jadwal-tahapan-tender", type: "legacy" },
    { label: "Legacy: Non-Tender Pengumuman", value: "/legacy/tender/non-tender-pengumuman", type: "legacy" },
    { label: "Legacy: Pencatatan Non-Tender", value: "/legacy/tender/pencatatan-non-tender", type: "legacy" },
    { label: "Legacy: Pencatatan Swakelola", value: "/legacy/tender/pencatatan-swakelola", type: "legacy" },
    { label: "Legacy: Pengumuman", value: "/legacy/tender/pengumuman", type: "legacy" },
    { label: "Legacy: Tender Ekontrak Kontrak", value: "/legacy/tender/tender-ekontrak-kontrak", type: "legacy" },
    // Legacy RUP
    { label: "Legacy: RUP Master Satker", value: "/legacy/rup/master-satker", type: "legacy" },
    { label: "Legacy: RUP Paket Anggaran Swakelola", value: "/legacy/rup/paket-anggaran-swakelola", type: "legacy" },
    { label: "Legacy: RUP Paket Anggaran Swakelola All Status", value: "/legacy/rup/paket-anggaran-swakelola-all-status", type: "legacy" },
    { label: "Legacy: RUP Paket Swakelola Terumumkan", value: "/legacy/rup/paket-swakelola-terumumkan", type: "legacy" },
    { label: "Legacy: RUP Paket Anggaran Penyedia", value: "/legacy/rup/paket-anggaran-penyedia", type: "legacy" },
    { label: "Legacy: RUP Paket Anggaran Penyedia All Status", value: "/legacy/rup/paket-anggaran-penyedia-all-status", type: "legacy" },
    { label: "Legacy: RUP Paket Penyedia Terumumkan", value: "/legacy/rup/paket-penyedia-terumumkan", type: "legacy" },
    { label: "Legacy: RUP Program Master", value: "/legacy/rup/program-master", type: "legacy" },
    // Legacy Bela
    { label: "Legacy: Bela Toko Daring Realisasi", value: "/legacy/bela/toko-daring-realisasi", type: "legacy" },
    // Legacy E-Katalog Archive (detail endpoints require specific IDs)
    { label: "Legacy: Instansi Satker (Archive)", value: "/legacy/ekatalog-archive/instansi-satker", type: "legacy" },
    { label: "Legacy: Paket E-Purchasing (Archive)", value: "/legacy/ekatalog-archive/paket-e-purchasing", type: "legacy" },
    { label: "⚠️ Legacy: Penyedia Distributor Detail", value: "/legacy/ekatalog-archive/penyedia-distributor-detail", type: "legacy", requiresId: true },
    { label: "⚠️ Legacy: Komoditas Detail", value: "/legacy/ekatalog-archive/komoditas-detail", type: "legacy", requiresId: true },
    { label: "⚠️ Legacy: Penyedia Detail (Archive)", value: "/legacy/ekatalog-archive/penyedia-detail", type: "legacy", requiresId: true },
    // Legacy E-Katalog Live
    { label: "⚠️ Legacy: Penyedia Detail (Live)", value: "/legacy/ekatalog/penyedia-detail", type: "legacy", requiresId: true },
    { label: "Legacy: Paket E-Purchasing (Live)", value: "/legacy/ekatalog/paket-e-purchasing", type: "legacy" },
];

// Helper function to check if endpoint is legacy
export const isLegacyEndpoint = (endpoint: string): boolean => {
    return endpoint.startsWith('/legacy/');
};

// Helper to get syncable endpoints (excludes those requiring specific IDs)
export const getSyncableEndpoints = () => {
    return ENDPOINTS.filter(ep => !ep.requiresId);
};
