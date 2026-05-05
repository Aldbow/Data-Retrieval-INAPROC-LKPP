/**
 * Excel Service
 * Handles Excel file operations with deduplication support
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { getFilePath, getUniqueKeyFields } from './drive-config';
import { ensureEndpointFolder } from './sync-state';

export interface ExcelOperationResult {
    success: boolean;
    newRecords: number;
    duplicatesSkipped: number;
    totalRecords: number;
    filePath: string;
    error?: string;
}

/**
 * Generate a unique key for a record based on endpoint-specific fields
 */
function generateRecordKey(record: any, keyFields: string[]): string {
    return keyFields
        .map(field => {
            // Support "OR" logic for fields (e.g. "kode_rup||kd_rup")
            if (field.includes('||')) {
                const options = field.split('||');
                for (const opt of options) {
                    // Check strict non-null/undefined. Empty string might be valid but usually ID is not empty.
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
 * Load existing records from Excel file
 */
export async function loadExistingRecords(
    filePath: string
): Promise<{ records: any[]; keys: Set<string>; keyFields: string[] }> {
    if (!fs.existsSync(filePath)) {
        return { records: [], keys: new Set(), keyFields: [] };
    }

    try {
        // Use buffer approach for better Windows compatibility
        const buffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(sheet);

        // Extract endpoint from file path to get key fields
        const fileName = path.basename(filePath, '.xlsx');
        const endpointName = fileName.split('_')[0];

        // Try to find key fields from the metadata sheet or use default
        let keyFields: string[] = ['kode_rup']; // Default
        if (workbook.SheetNames.includes('_metadata')) {
            const metaSheet = workbook.Sheets['_metadata'];
            const metaData = XLSX.utils.sheet_to_json(metaSheet);
            if (metaData.length > 0 && (metaData[0] as any).keyFields) {
                keyFields = JSON.parse((metaData[0] as any).keyFields);
            }
        }

        // Build set of existing keys for fast deduplication
        const keys = new Set<string>();
        records.forEach(record => {
            const key = generateRecordKey(record, keyFields);
            keys.add(key);
        });

        return { records, keys, keyFields };
    } catch (error) {
        console.error('Error loading existing records:', error);
        return { records: [], keys: new Set(), keyFields: [] };
    }
}

/**
 * Append new records to Excel file with deduplication
 */
export async function appendToExcel(
    endpoint: string,
    year: string,
    newData: any[]
): Promise<ExcelOperationResult> {
    const filePath = getFilePath(endpoint, year);
    const keyFields = getUniqueKeyFields(endpoint);

    try {
        // Ensure folder exists
        await ensureEndpointFolder(endpoint);

        // Load existing data
        const { records: existingRecords, keys: existingKeys } = await loadExistingRecords(filePath);

        // Filter out duplicates
        let duplicatesSkipped = 0;
        const uniqueNewRecords: any[] = [];

        console.log(`Deduplication using keys: [${keyFields.join(', ')}]`);
        console.log(`Existing records: ${existingRecords.length}, New data batch: ${newData.length}`);

        for (let i = 0; i < newData.length; i++) {
            const record = newData[i];
            let key = generateRecordKey(record, keyFields);

            // If key is empty or just pipe separators, use a fallback with all fields hash
            if (!key || key === '' || key.split('|').every(k => k === '')) {
                // Create a hash from all field values as fallback
                key = `__row_${JSON.stringify(record)}`;
            }

            if (!existingKeys.has(key)) {
                uniqueNewRecords.push(record);
                existingKeys.add(key);
            } else {
                duplicatesSkipped++;
            }
        }

        console.log(`New unique records: ${uniqueNewRecords.length}, Duplicates skipped: ${duplicatesSkipped}`);

        // Combine existing and new records
        const allRecords = [...existingRecords, ...uniqueNewRecords];

        // Create workbook
        const workbook = XLSX.utils.book_new();

        // Add data sheet
        const dataSheet = XLSX.utils.json_to_sheet(allRecords);
        XLSX.utils.book_append_sheet(workbook, dataSheet, `Data ${year}`);

        // Add metadata sheet for deduplication info
        const metaData = [{
            endpoint,
            year,
            keyFields: JSON.stringify(keyFields),
            lastUpdated: new Date().toISOString(),
            totalRecords: allRecords.length,
        }];
        const metaSheet = XLSX.utils.json_to_sheet(metaData);
        XLSX.utils.book_append_sheet(workbook, metaSheet, '_metadata');

        // Write file using buffer approach for better Windows compatibility
        console.log('Writing Excel file to:', filePath);
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        fs.writeFileSync(filePath, buffer);
        console.log('Excel file written successfully');

        return {
            success: true,
            newRecords: uniqueNewRecords.length,
            duplicatesSkipped,
            totalRecords: allRecords.length,
            filePath,
        };
    } catch (error: any) {
        console.error('Error appending to Excel:', error);
        return {
            success: false,
            newRecords: 0,
            duplicatesSkipped: 0,
            totalRecords: 0,
            filePath,
            error: error.message,
        };
    }
}

/**
 * Overwrite Excel file with new data (Safe Full Sync)
 * Used for Legacy endpoints to ensure no duplicates by replacing the entire file
 */
export async function overwriteExcel(
    endpoint: string,
    year: string,
    allData: any[]
): Promise<ExcelOperationResult> {
    const filePath = getFilePath(endpoint, year);
    const keyFields = getUniqueKeyFields(endpoint);

    try {
        // Ensure folder exists
        await ensureEndpointFolder(endpoint);

        console.log(`Overwrite Strategy: Writing ${allData.length} records to ${filePath}`);

        // Create new workbook
        const workbook = XLSX.utils.book_new();

        // Add data sheet
        const dataSheet = XLSX.utils.json_to_sheet(allData);
        XLSX.utils.book_append_sheet(workbook, dataSheet, `Data ${year}`);

        // Add metadata sheet
        const metaData = [{
            endpoint,
            year,
            keyFields: JSON.stringify(keyFields),
            lastUpdated: new Date().toISOString(),
            totalRecords: allData.length,
            syncType: 'overwrite'
        }];
        const metaSheet = XLSX.utils.json_to_sheet(metaData);
        XLSX.utils.book_append_sheet(workbook, metaSheet, '_metadata');

        // Write file (overwriting existing)
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        fs.writeFileSync(filePath, buffer);
        console.log('Excel file overwritten successfully');

        return {
            success: true,
            newRecords: allData.length, // In overwrite mode, all records are "freshly written"
            duplicatesSkipped: 0,
            totalRecords: allData.length,
            filePath,
        };
    } catch (error: any) {
        console.error('Error overwriting Excel:', error);
        return {
            success: false,
            newRecords: 0,
            duplicatesSkipped: 0,
            totalRecords: 0,
            filePath,
            error: error.message,
        };
    }
}

/**
 * Get file info for an endpoint/year
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
    const filePath = getFilePath(endpoint, year);

    if (!fs.existsSync(filePath)) {
        return {
            exists: false,
            path: filePath,
            size: 0,
            recordCount: 0,
        };
    }

    try {
        const stats = fs.statSync(filePath);
        let recordCount = 0;
        
        // Only load and parse the full Excel file if fastMode is false
        // Parsing full excel files for status checks causes severe performance issues
        if (!fastMode) {
            const { records } = await loadExistingRecords(filePath);
            recordCount = records.length;
        }

        return {
            exists: true,
            path: filePath,
            size: stats.size,
            recordCount,
        };
    } catch (error) {
        return {
            exists: false,
            path: filePath,
            size: 0,
            recordCount: 0,
        };
    }
}

/**
 * Delete data file for an endpoint/year (for testing or reset)
 */
export async function deleteDataFile(
    endpoint: string,
    year: string
): Promise<boolean> {
    const filePath = getFilePath(endpoint, year);

    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            return true;
        } catch (error) {
            console.error('Error deleting file:', error);
            return false;
        }
    }

    return true;
}
