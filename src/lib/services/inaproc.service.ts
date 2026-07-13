const BASE_URL = 'https://data.inaproc.id/api';

export class InaprocService {
  /**
   * Fetches data from the Inaproc API using a proxy method.
   */
  static async fetchEndpoint(endpoint: string, year: string, limit: string, cursor: string | null) {
    const jwtToken = process.env.JWT_TOKEN;
    
    if (!jwtToken) {
      throw new Error('JWT_TOKEN is not configured in environment variables');
    }

    if (!endpoint.startsWith('/v1/') && !endpoint.startsWith('/legacy/')) {
      throw new Error('Invalid endpoint path');
    }

    let apiUrl = `${BASE_URL}${endpoint}?limit=${limit}&tahun=${year}&kode_klpd=K34`;

    if (cursor) {
      apiUrl += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Inaproc API Error [${res.status}]: ${errorText}`);
    }

    const data = await res.json();

    // Normalisasi Legacy API
    if (Array.isArray(data)) {
      return {
        data: data,
        meta: { total: data.length, has_more: false }
      };
    }

    return {
      data: data.data || data,
      meta: data.meta || {}
    };
  }
}
