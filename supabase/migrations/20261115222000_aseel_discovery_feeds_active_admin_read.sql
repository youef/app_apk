-- Only active administrator accounts can read the discovery feed catalogue.
-- The server-only service role retains ownership of writes.
alter table public.aseel_studio_discovery_feeds enable row level security;
grant select on table public.aseel_studio_discovery_feeds to authenticated;
drop policy if exists aseel_discovery_feeds_active_admin_read on public.aseel_studio_discovery_feeds;
create policy aseel_discovery_feeds_active_admin_read on public.aseel_studio_discovery_feeds
for select to authenticated using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.aseel_admins admin
    where admin.user_id=(select auth.uid()) and admin.active = true
  )
);
