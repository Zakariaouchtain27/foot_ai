import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when real credentials are configured. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Warn loudly rather than throwing — placeholder values below keep the build
  // and prerender steps from crashing when env vars aren't set yet.
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. " +
      "Copy web/.env.local.example to web/.env.local and fill them in.",
  );
}

// createClient throws on an empty URL, so fall back to inert placeholders.
// Realtime/queries simply won't connect until real credentials are provided.
const url = supabaseUrl || "https://placeholder.supabase.co";
const anonKey = supabaseAnonKey || "public-anon-placeholder-key";

/**
 * Shared browser Supabase client. Realtime is tuned to a brisk cadence so
 * bench-side updates feel instant; eventsPerSecond caps the firehose.
 */
export const supabase = createClient(url, anonKey, {
  realtime: {
    params: { eventsPerSecond: 20 },
  },
  auth: {
    persistSession: false,
  },
});
