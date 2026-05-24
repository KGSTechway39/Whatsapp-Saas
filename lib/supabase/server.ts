import { createClient as _createClient } from "@supabase/supabase-js";

function db() {
  return _createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Both names used across API routes — both return the service-role client
export { db as createClient, db as createServiceClient };
