import { google } from 'googleapis';
import { Readable } from 'stream';

/**
 * Mendapatkan koneksi ke Google Drive API menggunakan kredensial Service Account
 */
const getDriveService = () => {
    try {
        const credentialsRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (!credentialsRaw) {
            console.warn('⚠️ GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
            return null;
        }

        const credentials = JSON.parse(credentialsRaw);
        
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        return google.drive({ version: 'v3', auth });
    } catch (error) {
        console.error('Error initializing Google Drive API:', error);
        return null;
    }
};

/**
 * Mencari apakah file dengan nama tertentu sudah ada di dalam folder Google Drive
 */
async function findFileInDrive(drive: any, fileName: string, folderId: string) {
    try {
        const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
        const response = await drive.files.list({
            q: query,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        
        const files = response.data.files;
        if (files && files.length > 0) {
            return files[0].id;
        }
        return null;
    } catch (error) {
        console.error('Error finding file in Drive:', error);
        return null;
    }
}

/**
 * Mengunggah atau Memperbarui (Overwrite) file Excel ke Google Drive
 */
export async function uploadExcelToDrive(
    fileName: string,
    fileBuffer: Buffer,
    folderId?: string
): Promise<{ success: boolean; fileId?: string; error?: string }> {
    const drive = getDriveService();
    if (!drive) {
        return { success: false, error: 'Google Drive client not initialized' };
    }

    const targetFolderId = folderId || process.env.GDRIVE_FOLDER_ID;
    if (!targetFolderId) {
        return { success: false, error: 'GDRIVE_FOLDER_ID is not configured' };
    }

    try {
        // Konversi buffer menjadi stream yang bisa dikonsumsi oleh Google API
        const stream = new Readable();
        stream.push(fileBuffer);
        stream.push(null);

        const media = {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: stream,
        };

        // Cek apakah file sudah ada
        const existingFileId = await findFileInDrive(drive, fileName, targetFolderId);

        if (existingFileId) {
            console.log(`Menimpa (Overwrite) file Excel yang sudah ada di GDrive: ${fileName} (${existingFileId})`);
            // Update isi file (Timpa)
            const response = await drive.files.update({
                fileId: existingFileId,
                media: media,
                fields: 'id, name',
            });
            return { success: true, fileId: response.data.id || undefined };
        } else {
            console.log(`Membuat file Excel baru di GDrive: ${fileName}`);
            // Buat file baru
            const fileMetadata = {
                name: fileName,
                parents: [targetFolderId],
            };
            const response = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id, name',
            });
            return { success: true, fileId: response.data.id || undefined };
        }
    } catch (error: any) {
        console.error('Gagal mengunggah ke Google Drive:', error);
        return { success: false, error: error.message };
    }
}
