import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const publicUrl = "https://natavrwljlohujgqpbff.supabase.co";
const publicAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hdGF2cndsamxvaHVqZ3FwYmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTY5NDYsImV4cCI6MjEwNjk3Mjk0Nn0.A37SRq5JHLWqY8dJRuKxHHpcf5SGnH_GqqkmbLwVVEs";

const url = import.meta.env.VITE_SUPABASE_URL || publicUrl;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || publicAnonKey;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
