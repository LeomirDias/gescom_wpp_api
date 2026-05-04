import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env";

export const supabase = createClient(
  env.DATABASE_URL,
  env.DRIZZLE_DATABASE_URL,
);
