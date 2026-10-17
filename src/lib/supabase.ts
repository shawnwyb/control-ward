import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when `.env.local` has not been generated; the app shows a setup screen. */
export const isConfigured = Boolean(url && key);
export const localDemo = import.meta.env.VITE_LOCAL_DEMO === "true";

// Never used while `isConfigured` is false (App renders the setup screen first).
export const supabase = isConfigured
  ? createClient<Database>(url, key)
  : (undefined as never);
