import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let supabaseClient: SupabaseClient | undefined;

export const getSupabaseAdminClient = (): SupabaseClient => {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database persistence.");
  }

  supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
};
