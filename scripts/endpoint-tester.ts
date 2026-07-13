async function testEndpoints() {
    console.log("🚀 Starting Pre-deployment Endpoint Verification...");
    
    const endpoints = [
        "https://data.inaproc.id/api/v1/ekatalog-archive/paket-e-purchasing?limit=1&tahun=2024&kode_klpd=K34",
    ];

    let hasError = false;
    const jwtToken = process.env.JWT_TOKEN;

    for (const url of endpoints) {
        try {
            console.log(`Checking endpoint: ${url}`);
            
            const headers: Record<string, string> = {
                'Accept': 'application/json',
            };
            if (jwtToken) {
                headers['Authorization'] = `Bearer ${jwtToken}`;
            }

            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, { 
                method: "GET", 
                headers,
                signal: controller.signal
            });
            clearTimeout(id);

            if (!response.ok && response.status !== 401) {
                console.error(`❌ Failed: ${url} (Status: ${response.status})`);
                hasError = true;
            } else {
                console.log(`✅ OK: ${url} (Status: ${response.status})`);
            }
        } catch (error) {
            console.error(`❌ Error fetching ${url}:`, error);
            hasError = true;
        }
    }

    if (hasError) {
        console.error("🚨 Pre-deployment check failed! Beberapa endpoint mati atau usang.");
        process.exitCode = 1;
    } else {
        console.log("✅ Semua endpoint dependensi sehat. Lanjut ke proses deployment...");
        process.exitCode = 0;
    }
}

testEndpoints();
