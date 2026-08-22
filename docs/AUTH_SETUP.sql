-- =========================================================
-- HAMMER CRAFT AUTH SETUP
-- Run in Supabase SQL Editor once.
-- =========================================================

alter table public.profiles
add column if not exists is_admin boolean
not null
default false;

-- Replace with your real admin email.
-- update public.profiles
-- set is_admin = true
-- where email = 'YOUR_ADMIN_EMAIL';

alter table public.profiles
enable row level security;


drop policy if exists
"Users can read own profile"
on public.profiles;

create policy
"Users can read own profile"
on public.profiles
for select
to authenticated
using (
    auth.uid() = id
);

-- Allow a signed-in customer to create only their own non-admin profile.
drop policy if exists
"Users can create own profile"
on public.profiles;

create policy
"Users can create own profile"
on public.profiles
for insert
to authenticated
with check (
    auth.uid() = id
    and is_admin = false
);

-- IMPORTANT:
-- Do not grant customers permission to update is_admin themselves.
