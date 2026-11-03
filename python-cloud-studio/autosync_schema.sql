-- AutoSync source memory. Additive and rerunnable; never edits publication/rights.
-- Source history is administrator-only. Public playback still uses stream_variants.
begin;

alter table public.aseel_series add column if not exists source_page_url text;
alter table public.aseel_episodes add column if not exists source_page_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.aseel_series'::regclass
                 and conname='aseel_series_source_page_url_https') then
    alter table public.aseel_series add constraint aseel_series_source_page_url_https
      check (source_page_url is null or (source_page_url ~ '^https://[^[:space:]]+$'
                                        and length(source_page_url)<=2048));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.aseel_episodes'::regclass
                 and conname='aseel_episodes_source_page_url_https') then
    alter table public.aseel_episodes add constraint aseel_episodes_source_page_url_https
      check (source_page_url is null or (source_page_url ~ '^https://[^[:space:]]+$'
                                        and length(source_page_url)<=2048));
  end if;
end $$;

comment on column public.aseel_series.source_page_url is
  'Original work page for AutoSync. Independent from expiring playback URLs.';
comment on column public.aseel_episodes.source_page_url is
  'Original episode page for AutoSync. Never infer a page from a playback URL.';

create table if not exists public.aseel_media_sources (
  id uuid primary key default gen_random_uuid(),
  target_table text not null check(target_table in ('aseel_movies','aseel_series','aseel_episodes')),
  target_id uuid not null,
  source_url text not null check(source_url ~ '^https://[^[:space:]]+$' and length(source_url)<=8192),
  source_key text generated always as (encode(extensions.digest(source_url,'sha256'),'hex')) stored,
  source_kind text not null check(source_kind in ('original','direct','embed')),
  page_url text check(page_url is null or (page_url ~ '^https://[^[:space:]]+$' and length(page_url)<=2048)),
  label text not null default '' check(length(label)<=120),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  status text not null default 'unchecked' check(status in ('unchecked','healthy','suspect','broken')),
  successes integer not null default 0 check(successes>=0),
  failures integer not null default 0 check(failures>=0),
  consecutive_failures integer not null default 0 check(consecutive_failures>=0),
  confidence numeric(6,5) not null default 0 check(confidence between 0 and 1),
  expires_at timestamptz,
  error text not null default '' check(length(error)<=500),
  constraint aseel_media_sources_target_source_unique unique(target_table,target_id,source_key),
  constraint aseel_media_sources_history_order check(last_seen_at>=first_seen_at)
);

comment on table public.aseel_media_sources is
  'Persistent UUID-bound history of original pages, direct streams and embed players. Never delete old sources when new signatures appear.';

create index if not exists aseel_media_sources_original_target_idx
  on public.aseel_media_sources(target_table,target_id) where source_kind='original';
create index if not exists aseel_media_sources_status_check_idx
  on public.aseel_media_sources(status,last_checked_at);

-- This invoker trigger validates the polymorphic UUID against the actual table.
-- It does not bypass RLS, change rights, or grant permissions to a caller.
create or replace function public.aseel_media_source_validate_target()
returns trigger language plpgsql security invoker set search_path='' as $$
declare target_exists boolean;
begin
  if tg_op='UPDATE' then
    if new.target_table<>old.target_table or new.target_id<>old.target_id
       or new.source_url<>old.source_url then
      raise exception using errcode='23514',message='Source identity is immutable; insert a new history row';
    end if;
    new.first_seen_at := old.first_seen_at;
    new.last_seen_at := greatest(old.last_seen_at,new.last_seen_at);
  else
    case new.target_table
      when 'aseel_movies' then select exists(select 1 from public.aseel_movies where id=new.target_id) into target_exists;
      when 'aseel_series' then select exists(select 1 from public.aseel_series where id=new.target_id) into target_exists;
      when 'aseel_episodes' then select exists(select 1 from public.aseel_episodes where id=new.target_id) into target_exists;
      else target_exists := false;
    end case;
    if not target_exists then
      raise exception using errcode='23503',message='Media source target does not exist or is not accessible';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.aseel_media_source_validate_target() from public,anon;
grant execute on function public.aseel_media_source_validate_target() to authenticated,service_role;
drop trigger if exists aseel_media_source_validate_target on public.aseel_media_sources;
create trigger aseel_media_source_validate_target before insert or update on public.aseel_media_sources
for each row execute function public.aseel_media_source_validate_target();

alter table public.aseel_media_sources enable row level security;
revoke all on table public.aseel_media_sources from public,anon,authenticated;
grant select,insert,update on table public.aseel_media_sources to authenticated,service_role;
revoke delete,truncate on table public.aseel_media_sources from authenticated,service_role;

drop policy if exists aseel_media_sources_admin_select on public.aseel_media_sources;
create policy aseel_media_sources_admin_select on public.aseel_media_sources for select to authenticated
using(exists(select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active));
drop policy if exists aseel_media_sources_admin_insert on public.aseel_media_sources;
create policy aseel_media_sources_admin_insert on public.aseel_media_sources for insert to authenticated
with check(exists(select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active));
drop policy if exists aseel_media_sources_admin_update on public.aseel_media_sources;
create policy aseel_media_sources_admin_update on public.aseel_media_sources for update to authenticated
using(exists(select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active))
with check(exists(select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active));

notify pgrst,'reload schema';
commit;
