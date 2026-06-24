/**
 * Drive Configuration for INAPROC Data Storage
 * Defines base path and folder mapping for each endpoint category
 */

import * as path from 'path';

// Base path can be overridden by environment variable
export const DRIVE_CONFIG = {
  basePath: process.env.SYNC_LOCATION || process.env.INAPROC_DATA_PATH || 'C:/Users/User/Documents/Aldiva/01 - DATABASE INAPROC LKPP',

  // Mapping endpoint path prefix to folder name
  folderMapping: {
    // V1 mappings
    '/v1/ekatalog-archive/': 'v1/ekatalog-archive',
    '/v1/ekatalog/': 'v1/ekatalog',
    '/v1/rup/': 'v1/rup',
    '/v1/tender/': 'v1/tender',

    // Legacy mappings
    '/legacy/bela/': 'legacy/bela',
    '/legacy/ekatalog-archive/': 'legacy/ekatalog-archive',
    '/legacy/ekatalog/': 'legacy/ekatalog',
    '/legacy/rup/': 'legacy/rup',
    '/legacy/tender/': 'legacy/tender',
  } as Record<string, string>,
};

/**
 * Get the folder path for a given endpoint
 * @param endpoint The API endpoint path
 * @returns The full folder path for storing data
 */
export function getFolderPath(endpoint: string): string {
  for (const [prefix, folder] of Object.entries(DRIVE_CONFIG.folderMapping)) {
    if (endpoint.startsWith(prefix)) {
      return path.join(DRIVE_CONFIG.basePath, folder);
    }
  }
  // Default to 'other' folder if no mapping found
  return path.join(DRIVE_CONFIG.basePath, 'other');
}

/**
 * Get the file name for a given endpoint and year
 * @param endpoint The API endpoint path
 * @param year The year of data
 * @returns The file name (without path)
 */
export function getFileName(endpoint: string, year: string): string {
  // Extract the last part of the endpoint as file name
  const parts = endpoint.split('/');
  const endpointName = parts[parts.length - 1];
  return `${endpointName}_${year}.xlsx`;
}

/**
 * Get the full file path for a given endpoint and year
 * @param endpoint The API endpoint path
 * @param year The year of data
 * @returns The full file path
 */
export function getFilePath(endpoint: string, year: string): string {
  const folder = getFolderPath(endpoint);
  const fileName = getFileName(endpoint, year);
  return path.join(folder, fileName);
}

/**
 * Get unique key fields for deduplication based on endpoint
 * Different endpoints may have different primary key fields
 */
export function getUniqueKeyFields(endpoint: string): string[] {
  // Map endpoints to their unique identifier fields
  const keyMappings: Record<string, string[]> = {
    'paket-e-purchasing': ['kd_paket', 'kode_rup||kd_rup'],
    'instansi-satker': ['kode_klpd||kd_klpd', 'kode_satker||kd_satker'],
    'komoditas-detail': ['id_komoditas', 'kode_produk'],
    'penyedia-detail': ['kd_penyedia', 'npwp'],
    'penyedia-distributor-detail': ['kd_penyedia', 'kd_distributor'],
    'master-satker': ['kode_klpd||kd_klpd', 'kode_satker||kd_satker'],
    'paket-anggaran-penyedia': ['kode_rup||kd_rup'],
    'paket-anggaran-swakelola': ['kode_rup||kd_rup'],
    'paket-penyedia-terumumkan': ['kode_rup||kd_rup'],
    'paket-swakelola-terumumkan': ['kode_rup||kd_rup'],
    'program-master': ['kode_program||kd_program'],
    'jadwal-tahapan-non-tender': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kode_tahap'],
    'jadwal-tahapan-tender': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kode_tahap'],
    'non-tender-ekontrak-kontrak': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kd_kontrak'],
    'non-tender-pengumuman': ['kode_lelang||kd_lelang||kode_rup||kd_rup'],
    'non-tender-selesai': ['kode_lelang||kd_lelang||kode_rup||kd_rup'],
    'pencatatan-non-tender': ['kode_lelang||kd_lelang||kode_rup||kd_rup'],
    'pencatatan-non-tender-realisasi': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'id_realisasi'],
    'pencatatan-swakelola': ['kode_rup||kd_rup'],
    'pencatatan-swakelola-realisasi': ['kode_rup||kd_rup', 'id_realisasi'],
    'pengumuman': ['kode_lelang||kd_lelang||kode_rup||kd_rup'],
    'peserta-tender': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kd_penyedia'],
    'tender-ekontrak-kontrak': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kd_kontrak'],
    'tender-ekontrak': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kd_kontrak'],
    'tender-selesai-nilai': ['kode_lelang||kd_lelang||kode_rup||kd_rup'],
    'non-tender-ekontrak': ['kode_lelang||kd_lelang||kode_rup||kd_rup', 'kd_kontrak'],
    'toko-daring-realisasi': ['kode_rup||kd_rup', 'id_realisasi'],
    'paket-anggaran-penyedia-all-status': ['kode_rup||kd_rup'],
    'paket-anggaran-swakelola-all-status': ['kode_rup||kd_rup'],
  };

  // Extract endpoint name from path
  const parts = endpoint.split('/');
  const endpointName = parts[parts.length - 1];

  return keyMappings[endpointName] || ['kode_rup']; // Default to kode_rup
}
