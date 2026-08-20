const HC_SUPABASE_URL =
    "https://oljniflqfchxaqamcxam.supabase.co";

const HC_SUPABASE_KEY =
    "sb_publishable_XCsum6bA-gwy0etlzArqNA_LxU4K3Ip";


window.hcSupabase =
    window.supabase.createClient(
        HC_SUPABASE_URL,
        HC_SUPABASE_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );


console.log(
    "Hammer Craft Supabase client loaded."
);