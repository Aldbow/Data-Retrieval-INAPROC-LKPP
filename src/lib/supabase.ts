import { createClient } from '@supabase/supabase-js';

// Pastikan Environment Variables ini di-set di Vercel (.env.local)
const supabaseUrl = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'dummy_key';

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ Supabase credentials are missing. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
}

// Kita menggunakan Service Role Key agar API punya hak akses admin (bypass RLS) untuk insert/update data.
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
    }
});
