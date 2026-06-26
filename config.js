/* ASIMETRIJA — client config (loaded by index.html before the app script)
 *
 * Fill these two values AFTER you create your Supabase project
 * (Dashboard → Project Settings → Data API / API Keys):
 *
 *   url     = Project URL          e.g. https://abcdefgh.supabase.co
 *   anonKey = anon / publishable key (the long "anon public" key)
 *
 * These two are SAFE to be public — Row Level Security (RLS) protects your rows,
 * so anyone with this key still can't read data without your login session.
 * NEVER put the service_role / secret key here.
 *
 * While these stay as placeholders, the app runs in OFFLINE mode (localStorage only),
 * exactly like before — so it works even before Supabase is set up.
 */
window.ASIM_CONFIG = {
  url:     "YOUR_SUPABASE_PROJECT_URL",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
