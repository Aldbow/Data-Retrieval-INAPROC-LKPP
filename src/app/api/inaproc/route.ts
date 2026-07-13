import { InaprocService } from '@/lib/services/inaproc.service';
import { ApiResponder } from '@/lib/utils/api-response';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || '/v1/ekatalog-archive/paket-e-purchasing';
    const year = searchParams.get('year') || '2024';
    const limit = searchParams.get('limit') || '50';
    const cursor = searchParams.get('cursor');

    try {
        const result = await InaprocService.fetchEndpoint(endpoint, year, limit, cursor);
        return ApiResponder.success(result.data, result.meta);
    } catch (error: any) {
        console.error('[API/Inaproc] Error:', error.message);
        
        // Return 400 for bad input, 500 for auth or server errors
        const status = error.message.includes('Invalid') ? 400 : 500;
        return ApiResponder.error(error.message, status);
    }
}
