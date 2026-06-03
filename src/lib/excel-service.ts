import { supabase } from './supabase';
import { uploadExcelToDrive } from './gdrive';
import { getUniqueKeyFields } from './drive-config';
import * as XLSX from 'xlsx';

export interface ExcelOperationResult {
    success: boolean;
    newRecords: number;
    duplicatesSkipped: number;
    totalRecords: number;
    filePath: string;
    error?: string;
}

function generateRecordKey(record: any, keyFields: string[]): string {
    return keyFields
        .map(field => {
            if (field.includes('||')) {
                const options = field.split('||');
                for (const opt of options) {
                    if (record[opt] !== undefined && record[opt] !== null && String(record[opt]).trim() !== '') {
                        return String(record[opt]);
                    }
                }
                return '';
            }
            return String(record[field] || '');
        })
        .join('|');
}

/**
 * Get accurate record count from Supabase
 */
export async function getFileInfo(
    endpoint: string,
    year: string,
    fastMode: boolean = true
): Promise<{
    exists: boolean;
    path: string;
    size: number;
    recordCount: number;
}> {
    const { count, error } = await supabase
        .from('inaproc_data')
        .select('*', { count: 'exact', head: true })
        .eq('endpoint', endpoint)
        .eq('year', year);

    return {
        exists: count !== null && count > 0,
        path: `Supabase/GDrive`,
        size: 0,
        recordCount: count || 0,
    };
}

/**
 * Delete records from Supabase
 */
export async function deleteDataFile(
    endpoint: string,
    year: string
): Promise<boolean> {
    const { error } = await supabase
        .from('inaproc_data')
        .delete()
        .eq('endpoint', endpoint)
        .eq('year', year);
    return !error;
}

/**
 * Bulk Upsert records to Supabase
 */
export async function appendToExcel(
    endpoint: string,
    year: string,
    newData: any[]
): Promise<ExcelOperationResult> {
    const keyFields = getUniqueKeyFields(endpoint);

    try {
        console.log(`Menyiapkan ${newData.length} data untuk di-upsert ke Supabase`);
        
        const upsertPayload = newData.map(record => {
            let key = generateRecordKey(record, keyFields);
            if (!key || key === '' || key.split('|').every(k => k === '')) {
                key = `__row_${JSON.stringify(record)}`;
            }
            return {
                endpoint,
                year,
                record_id: key,
                data: record
            };
        });

        // Supabase bulk upsert
        const { error } = await supabase
            .from('inaproc_data')
            .upsert(upsertPayload, { onConflict: 'endpoint, year, record_id' });

        if (error) throw error;

        // Get total records
        const { count } = await supabase
            .from('inaproc_data')
            .select('*', { count: 'exact', head: true })
            .eq('endpoint', endpoint)
            .eq('year', year);

        return {
            success: true,
            newRecords: newData.length, // Upsert might overwrite, we approximate for UI
            duplicatesSkipped: 0,
            totalRecords: count || 0,
            filePath: 'Supabase Database',
        };
    } catch (error: any) {
        console.error('Error upserting to Supabase:', error);
        return {
            success: false,
            newRecords: 0,
            duplicatesSkipped: 0,
            totalRecords: 0,
            filePath: '',
            error: error.message,
        };
    }
}

/**
 * Overwrite is the same as Upsert in Supabase unless we want to delete first.
 * For legacy endpoints, we'll delete the existing year data and insert fresh.
 */
export async function overwriteExcel(
    endpoint: string,
    year: string,
    allData: any[]
): Promise<ExcelOperationResult> {
    try {
        await deleteDataFile(endpoint, year);
        return await appendToExcel(endpoint, year, allData);
    } catch (error: any) {
        return {
            success: false,
            newRecords: 0,
            duplicatesSkipped: 0,
            totalRecords: 0,
            filePath: '',
            error: error.message,
        };
    }
}

/**
 * Ekspor data dari Supabase ke file Excel lalu Upload ke GDrive
 */
export async function exportToGDrive(endpoint: string, year: string) {
    try {
        console.log(`Mengekspor data ke Excel untuk GDrive: ${endpoint} ${year}`);
        
        // Paginasi query ke Supabase jika datanya besar
        let allRecords: any[] = [];
        let limit = 5000;
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
            const { data, error } = await supabase
                .from('inaproc_data')
                .select('data')
                .eq('endpoint', endpoint)
                .eq('year', year)
                .range(offset, offset + limit - 1);
                
            if (error) throw error;
            
            if (data && data.length > 0) {
                allRecords.push(...data.map(d => d.data));
                offset += limit;
            } else {
                hasMore = false;
            }
        }
        
        if (allRecords.length === 0) {
            return { success: true, message: 'No records to export' };
        }
        
        const workbook = XLSX.utils.book_new();
        const dataSheet = XLSX.utils.json_to_sheet(allRecords);
        XLSX.utils.book_append_sheet(workbook, dataSheet, `Data ${year}`);
        
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        // Format nama file: V1_E_Purchasing_2026.xlsx
        const cleanName = endpoint.split('/').filter(Boolean).join('_');
        const fileName = `${cleanName}_${year}.xlsx`;
        
        console.log(`Mengunggah ke GDrive: ${fileName} (${buffer.length} bytes)`);
        const result = await uploadExcelToDrive(fileName, buffer);
        
        return result;
    } catch (error: any) {
        console.error('Export to GDrive gagal:', error);
        return { success: false, error: error.message };
    }
}
