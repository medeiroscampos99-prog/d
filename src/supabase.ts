import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gwfkoenpkcwdvcqprsff.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZmtvZW5wa2N3ZHZjcXByc2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MjY5MTUsImV4cCI6MjA4OTIwMjkxNX0.1VLRjoNMtnhBjJCm7H96DZ26qNwC0f1wIiqCnmbFSCY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
