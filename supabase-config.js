window.SUPABASE_CONFIG = {
    url: "https://vzyvefpuywvvmcjqvuph.supabase.co",
    publishableKey: "sb_publishable_7sdmtmtKUptevdFeERDRYg_gkyLefDx"
};

(function createSupabaseClient() {
    const { url, publishableKey } = window.SUPABASE_CONFIG;
    const isConfigured =
        url &&
        publishableKey &&
        !url.startsWith("YOUR_") &&
        !publishableKey.startsWith("YOUR_");

    window.isSupabaseConfigured = Boolean(isConfigured);

    if (window.isSupabaseConfigured && window.supabase) {
        window.supabaseClient = window.supabase.createClient(url, publishableKey);
    }
})();
