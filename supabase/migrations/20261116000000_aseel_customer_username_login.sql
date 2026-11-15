-- Customer username directory. No browser or authenticated user can read it.
-- The Studio backend looks up usernames with a server-side service role
-- and delegates password verification to Supabase Auth.
create table if not exists public.aseel_customer_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (length(username) between 3 and 64 and username !~ '[[:space:]]'),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists aseel_customer_accounts_username_unique
  on public.aseel_customer_accounts (lower(username));
alter table public.aseel_customer_accounts enable row level security;
revoke all on public.aseel_customer_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.aseel_customer_accounts to service_role;
with candidates as (
 select u.id, lower(regexp_replace(split_part(u.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')) as stem
 from auth.users u
 where u.email is not null
 and not exists (select 1 from public.aseel_admins a where a.user_id=u.id)
), prepared as (
 select id, case when length(stem) between 3 and 44
 and count(*) over (partition by stem)=1
 then stem else 'member-' || substr(replace(id::text,'-',''),1,12) end as proposed
 from candidates
)
insert into public.aseel_customer_accounts (user_id, username)
select id, proposed from prepared
on conflict (user_id) do nothing;
