-- Al Ezz TV additive schema for viewer profiles, child controls, playlists, EPG, diagnostics and admin operations.

-- All new tables are isolated; no existing catalog table or data is dropped.

-- RLS is enabled and explicit grants are applied before policies.

create table if not exists public.aseel_viewer_profiles (
user_id uuid primary key references auth.users(id) on delete cascade,
display_name text check (display_name is null or length(display_name)<=100),
avatar_url text check (avatar_url is null or avatar_url like 'https://%'),
language_code text not null default 'ar', country_code text,
auto_play_next boolean not null default true,
preferred_quality text not null default 'AUTO',
subtitle_language text, video_fit text not null default 'contain' check (video_fit in ('contain','cover')),
data_saver boolean not null default false, notifications_enabled boolean not null default true,
created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.aseel_viewer_profiles enable row level security;

revoke all on table public.aseel_viewer_profiles from anon,authenticated;

grant all on table public.aseel_viewer_profiles to service_role;

grant select,insert,update,delete on table public.aseel_viewer_profiles to authenticated;

create policy aseel_viewer_profiles_select_authenticated on public.aseel_viewer_profiles for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_viewer_profiles_insert_authenticated on public.aseel_viewer_profiles for insert to authenticated with check (user_id=(select auth.uid()));

create policy aseel_viewer_profiles_update_authenticated on public.aseel_viewer_profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy aseel_viewer_profiles_delete_authenticated on public.aseel_viewer_profiles for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.aseel_child_profiles (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
name text not null check (length(trim(name)) between 1 and 80),
age_band text not null check (age_band in ('0-4','5-7','8-12','13-17')),
daily_limit_minutes integer not null default 60 check (daily_limit_minutes between 1 and 600),
autoplay_next boolean not null default false,
allowed_ratings text[] not null default array['all']::text[],
is_active boolean not null default true,
created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.aseel_child_profiles enable row level security;

revoke all on table public.aseel_child_profiles from anon,authenticated;

grant all on table public.aseel_child_profiles to service_role;

grant select,insert,update,delete on table public.aseel_child_profiles to authenticated;

create policy aseel_child_profiles_select_authenticated on public.aseel_child_profiles for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_child_profiles_insert_authenticated on public.aseel_child_profiles for insert to authenticated with check (user_id=(select auth.uid()));

create policy aseel_child_profiles_update_authenticated on public.aseel_child_profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy aseel_child_profiles_delete_authenticated on public.aseel_child_profiles for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.aseel_child_allowlist (
child_profile_id uuid not null references public.aseel_child_profiles(id) on delete cascade,
item_type text not null check (item_type in ('movie','series','episode','channel')),
item_id uuid not null, added_at timestamptz not null default now(),
primary key(child_profile_id,item_type,item_id)
);

alter table public.aseel_child_allowlist enable row level security;

revoke all on table public.aseel_child_allowlist from anon,authenticated;

grant all on table public.aseel_child_allowlist to service_role;

grant select,insert,update,delete on table public.aseel_child_allowlist to authenticated;

create policy aseel_child_allowlist_select_authenticated on public.aseel_child_allowlist for select to authenticated using (exists (select 1 from public.aseel_child_profiles p where p.id=child_profile_id and p.user_id=(select auth.uid())));

create policy aseel_child_allowlist_insert_authenticated on public.aseel_child_allowlist for insert to authenticated with check (exists (select 1 from public.aseel_child_profiles p where p.id=child_profile_id and p.user_id=(select auth.uid())));

create policy aseel_child_allowlist_update_authenticated on public.aseel_child_allowlist for update to authenticated using (exists (select 1 from public.aseel_child_profiles p where p.id=child_profile_id and p.user_id=(select auth.uid()))) with check (exists (select 1 from public.aseel_child_profiles p where p.id=child_profile_id and p.user_id=(select auth.uid())));

create policy aseel_child_allowlist_delete_authenticated on public.aseel_child_allowlist for delete to authenticated using (exists (select 1 from public.aseel_child_profiles p where p.id=child_profile_id and p.user_id=(select auth.uid())));

create table if not exists public.aseel_playlists (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
name text not null check (length(trim(name)) between 1 and 100),
description text, is_default boolean not null default false,
created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

alter table public.aseel_playlists enable row level security;

revoke all on table public.aseel_playlists from anon,authenticated;

grant all on table public.aseel_playlists to service_role;

grant select,insert,update,delete on table public.aseel_playlists to authenticated;

create policy aseel_playlists_select_authenticated on public.aseel_playlists for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_playlists_insert_authenticated on public.aseel_playlists for insert to authenticated with check (user_id=(select auth.uid()));

create policy aseel_playlists_update_authenticated on public.aseel_playlists for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy aseel_playlists_delete_authenticated on public.aseel_playlists for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.aseel_playlist_items (
playlist_id uuid not null references public.aseel_playlists(id) on delete cascade,
item_type text not null check (item_type in ('movie','series','episode','channel')),
item_id uuid not null,position integer not null default 0,
added_at timestamptz not null default now(),primary key(playlist_id,item_type,item_id)
);

alter table public.aseel_playlist_items enable row level security;

revoke all on table public.aseel_playlist_items from anon,authenticated;

grant all on table public.aseel_playlist_items to service_role;

grant select,insert,update,delete on table public.aseel_playlist_items to authenticated;

create policy aseel_playlist_items_select_authenticated on public.aseel_playlist_items for select to authenticated using (exists (select 1 from public.aseel_playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));

create policy aseel_playlist_items_insert_authenticated on public.aseel_playlist_items for insert to authenticated with check (exists (select 1 from public.aseel_playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));

create policy aseel_playlist_items_update_authenticated on public.aseel_playlist_items for update to authenticated using (exists (select 1 from public.aseel_playlists p where p.id=playlist_id and p.user_id=(select auth.uid()))) with check (exists (select 1 from public.aseel_playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));

create policy aseel_playlist_items_delete_authenticated on public.aseel_playlist_items for delete to authenticated using (exists (select 1 from public.aseel_playlists p where p.id=playlist_id and p.user_id=(select auth.uid())));

create table if not exists public.aseel_watch_history (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
item_type text not null check (item_type in ('movie','series','episode','channel','youtube')),
item_id uuid not null,episode_id uuid references public.aseel_episodes(id) on delete set null,
position_ms bigint not null default 0 check (position_ms>=0),
duration_ms bigint check (duration_ms is null or duration_ms>=0),
completed boolean not null default false,quality text,
device_type text,watched_at timestamptz not null default now()
);

alter table public.aseel_watch_history enable row level security;

revoke all on table public.aseel_watch_history from anon,authenticated;

grant all on table public.aseel_watch_history to service_role;

grant select,insert,update,delete on table public.aseel_watch_history to authenticated;

create policy aseel_watch_history_select_authenticated on public.aseel_watch_history for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_watch_history_insert_authenticated on public.aseel_watch_history for insert to authenticated with check (user_id=(select auth.uid()));

create policy aseel_watch_history_update_authenticated on public.aseel_watch_history for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy aseel_watch_history_delete_authenticated on public.aseel_watch_history for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.aseel_epg_programs (
id uuid primary key default gen_random_uuid(),
channel_id uuid not null references public.aseel_channels(id) on delete cascade,
title_ar text not null check (length(trim(title_ar)) between 1 and 250),
description text,genre text,poster_url text,source_url text,
language_code text not null default 'ar',
starts_at timestamptz not null,ends_at timestamptz not null,
created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
constraint aseel_epg_interval_valid check (ends_at>starts_at)
);

alter table public.aseel_epg_programs enable row level security;

revoke all on table public.aseel_epg_programs from anon,authenticated;

grant all on table public.aseel_epg_programs to service_role;

grant select on table public.aseel_epg_programs to anon,authenticated;

grant insert,update,delete on table public.aseel_epg_programs to authenticated;

create policy aseel_epg_programs_select_anon on public.aseel_epg_programs for select to anon using (exists (select 1 from public.aseel_channels c where c.id=channel_id and c.status='published'));

create policy aseel_epg_programs_select_authenticated on public.aseel_epg_programs for select to authenticated using ((exists (select 1 from public.aseel_channels c where c.id=channel_id and c.status='published') or exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)));

create policy aseel_epg_programs_insert_authenticated on public.aseel_epg_programs for insert to authenticated with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_epg_programs_update_authenticated on public.aseel_epg_programs for update to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)) with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_epg_programs_delete_authenticated on public.aseel_epg_programs for delete to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_playback_reports (
id uuid primary key default gen_random_uuid(),
user_id uuid references auth.users(id) on delete set null,
item_type text not null check (item_type in ('movie','series','episode','channel','youtube')),
item_id uuid not null,source_url_hash text,
error_code text, http_status integer check (http_status is null or http_status between 100 and 599),
error_message text,player_engine text,platform text,device_model text,app_version text,
media_codec text,playback_position_ms bigint check (playback_position_ms is null or playback_position_ms>=0),
status text not null default 'new' check(status in ('new','reviewing','resolved','ignored')),
resolution_note text,created_at timestamptz not null default now(),resolved_at timestamptz
);

alter table public.aseel_playback_reports enable row level security;

revoke all on table public.aseel_playback_reports from anon,authenticated;

grant all on table public.aseel_playback_reports to service_role;

grant select,insert on table public.aseel_playback_reports to authenticated;

create policy aseel_playback_reports_select_authenticated on public.aseel_playback_reports for select to authenticated using ((user_id=(select auth.uid()) or exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)));

create policy aseel_playback_reports_insert_authenticated on public.aseel_playback_reports for insert to authenticated with check (user_id=(select auth.uid()));

grant update,delete on table public.aseel_playback_reports to authenticated;

create policy aseel_playback_reports_update_authenticated on public.aseel_playback_reports for update to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)) with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_playback_reports_delete_authenticated on public.aseel_playback_reports for delete to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_stream_check_results (
id uuid primary key default gen_random_uuid(),
item_type text not null check (item_type in ('movie','episode','channel','youtube')),
item_id uuid not null,
source_role text not null check (source_role in ('primary','variant','youtube','official')),
source_index integer not null default 0 check (source_index between 0 and 20),
url_hash text not null,source_label text,stream_format text,
health_status text not null check (health_status in ('healthy','suspect','broken','unchecked')),
http_status integer check (http_status is null or http_status between 100 and 599),
reason text,checked_at timestamptz not null default now(),
checked_by uuid references auth.users(id) on delete set null,
unique(item_type,item_id,source_role,source_index)
);

alter table public.aseel_stream_check_results enable row level security;

revoke all on table public.aseel_stream_check_results from anon,authenticated;

grant all on table public.aseel_stream_check_results to service_role;

grant select,insert,update,delete on table public.aseel_stream_check_results to authenticated;

create policy aseel_stream_check_results_select_authenticated on public.aseel_stream_check_results for select to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_stream_check_results_insert_authenticated on public.aseel_stream_check_results for insert to authenticated with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_stream_check_results_update_authenticated on public.aseel_stream_check_results for update to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)) with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_stream_check_results_delete_authenticated on public.aseel_stream_check_results for delete to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_import_jobs (
id uuid primary key default gen_random_uuid(),
created_by uuid references auth.users(id) on delete set null,
job_kind text not null check (job_kind in ('movie','series','episode','channel','playlist','bulk')),
source_url text,status text not null default 'queued'
check (status in ('queued','running','paused','completed','failed','cancelled')),
total_count integer not null default 0 check (total_count>=0),
processed_count integer not null default 0 check (processed_count>=0),
created_count integer not null default 0 check (created_count>=0),
rejected_count integer not null default 0 check (rejected_count>=0),
last_error text,metadata jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),started_at timestamptz,finished_at timestamptz
);

alter table public.aseel_import_jobs enable row level security;

revoke all on table public.aseel_import_jobs from anon,authenticated;

grant all on table public.aseel_import_jobs to service_role;

grant select,insert,update,delete on table public.aseel_import_jobs to authenticated;

create policy aseel_import_jobs_select_authenticated on public.aseel_import_jobs for select to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_import_jobs_insert_authenticated on public.aseel_import_jobs for insert to authenticated with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_import_jobs_update_authenticated on public.aseel_import_jobs for update to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)) with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_import_jobs_delete_authenticated on public.aseel_import_jobs for delete to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_import_job_items (
id uuid primary key default gen_random_uuid(),
job_id uuid not null references public.aseel_import_jobs(id) on delete cascade,
item_type text not null check (item_type in ('movie','series','episode','channel')),
title text,season_number integer,episode_number integer,source_url text,target_id uuid,
status text not null default 'pending' check(status in ('pending','processing','imported','skipped','failed')),
validation_status text,error_message text,metadata jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

alter table public.aseel_import_job_items enable row level security;

revoke all on table public.aseel_import_job_items from anon,authenticated;

grant all on table public.aseel_import_job_items to service_role;

grant select,insert,update,delete on table public.aseel_import_job_items to authenticated;

create policy aseel_import_job_items_select_authenticated on public.aseel_import_job_items for select to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_import_job_items_insert_authenticated on public.aseel_import_job_items for insert to authenticated with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_import_job_items_update_authenticated on public.aseel_import_job_items for update to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)) with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_import_job_items_delete_authenticated on public.aseel_import_job_items for delete to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_admin_audit_logs (
id uuid primary key default gen_random_uuid(),
actor_id uuid references auth.users(id) on delete set null,
action text not null,entity_table text not null,entity_id uuid,
before_data jsonb,after_data jsonb,request_id text,
created_at timestamptz not null default now()
);

alter table public.aseel_admin_audit_logs enable row level security;

revoke all on table public.aseel_admin_audit_logs from anon,authenticated;

grant all on table public.aseel_admin_audit_logs to service_role;

grant select on table public.aseel_admin_audit_logs to authenticated;

create policy aseel_admin_audit_logs_select_authenticated on public.aseel_admin_audit_logs for select to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_subtitle_tracks (
id uuid primary key default gen_random_uuid(),
media_type text not null check (media_type in ('movie','episode')),
media_id uuid not null,language_code text not null,label text,
format text not null check (format in ('vtt','srt')),
subtitle_url text not null check (subtitle_url like 'https://%'),
is_default boolean not null default false,is_published boolean not null default false,
created_by uuid references auth.users(id) on delete set null,
created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
unique(media_type,media_id,language_code,subtitle_url)
);

alter table public.aseel_subtitle_tracks enable row level security;

revoke all on table public.aseel_subtitle_tracks from anon,authenticated;

grant all on table public.aseel_subtitle_tracks to service_role;

grant select on table public.aseel_subtitle_tracks to anon,authenticated;

grant insert,update,delete on table public.aseel_subtitle_tracks to authenticated;

create policy aseel_subtitle_tracks_select_anon on public.aseel_subtitle_tracks for select to anon using ((is_published and ((media_type='movie' and exists (select 1 from public.aseel_movies m where m.id=media_id and m.status='published')) or (media_type='episode' and exists (select 1 from public.aseel_episodes e where e.id=media_id and e.status='published')))));

create policy aseel_subtitle_tracks_select_authenticated on public.aseel_subtitle_tracks for select to authenticated using (((is_published and ((media_type='movie' and exists (select 1 from public.aseel_movies m where m.id=media_id and m.status='published')) or (media_type='episode' and exists (select 1 from public.aseel_episodes e where e.id=media_id and e.status='published')))) or exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)));

create policy aseel_subtitle_tracks_insert_authenticated on public.aseel_subtitle_tracks for insert to authenticated with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_subtitle_tracks_update_authenticated on public.aseel_subtitle_tracks for update to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true)) with check (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create policy aseel_subtitle_tracks_delete_authenticated on public.aseel_subtitle_tracks for delete to authenticated using (exists (select 1 from public.aseel_admins a where a.user_id=(select auth.uid()) and a.active=true));

create table if not exists public.aseel_offline_downloads (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
item_type text not null check (item_type in ('movie','episode')),
item_id uuid not null,quality text not null default 'AUTO',
state text not null default 'queued' check (state in ('queued','downloading','completed','expired','deleted','failed')),
downloaded_bytes bigint not null default 0 check (downloaded_bytes>=0),
total_bytes bigint check (total_bytes is null or total_bytes>=0),
license_expires_at timestamptz,
created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
unique(user_id,item_type,item_id,quality)
);

alter table public.aseel_offline_downloads enable row level security;

revoke all on table public.aseel_offline_downloads from anon,authenticated;

grant all on table public.aseel_offline_downloads to service_role;

grant select,insert,update,delete on table public.aseel_offline_downloads to authenticated;

create policy aseel_offline_downloads_select_authenticated on public.aseel_offline_downloads for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_offline_downloads_insert_authenticated on public.aseel_offline_downloads for insert to authenticated with check (user_id=(select auth.uid()));

create policy aseel_offline_downloads_update_authenticated on public.aseel_offline_downloads for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy aseel_offline_downloads_delete_authenticated on public.aseel_offline_downloads for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.aseel_device_sessions (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
device_hash text not null check (length(device_hash) between 16 and 128),
platform text not null check (platform in ('android','ios','web','tv','desktop','other')),
device_model text,app_version text,last_seen_at timestamptz not null default now(),
created_at timestamptz not null default now(),
unique(user_id,device_hash)
);

alter table public.aseel_device_sessions enable row level security;

revoke all on table public.aseel_device_sessions from anon,authenticated;

grant all on table public.aseel_device_sessions to service_role;

grant select,insert,update,delete on table public.aseel_device_sessions to authenticated;

create policy aseel_device_sessions_select_authenticated on public.aseel_device_sessions for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_device_sessions_insert_authenticated on public.aseel_device_sessions for insert to authenticated with check (user_id=(select auth.uid()));

create policy aseel_device_sessions_update_authenticated on public.aseel_device_sessions for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy aseel_device_sessions_delete_authenticated on public.aseel_device_sessions for delete to authenticated using (user_id=(select auth.uid()));

create table if not exists public.aseel_notifications (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
title text not null,body text,
notification_type text not null default 'general',
item_type text,item_id uuid,read_at timestamptz,
created_at timestamptz not null default now()
);

alter table public.aseel_notifications enable row level security;

revoke all on table public.aseel_notifications from anon,authenticated;

grant all on table public.aseel_notifications to service_role;

grant select,update(read_at) on table public.aseel_notifications to authenticated;

create policy aseel_notifications_select_authenticated on public.aseel_notifications for select to authenticated using (user_id=(select auth.uid()));

create policy aseel_notifications_update_authenticated on public.aseel_notifications for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create index if not exists aseel_child_profiles_owner_idx on public.aseel_child_profiles(user_id);

create index if not exists aseel_playlists_owner_idx on public.aseel_playlists(user_id);

create index if not exists aseel_watch_history_owner_time_idx on public.aseel_watch_history(user_id,watched_at desc);

create index if not exists aseel_watch_history_item_idx on public.aseel_watch_history(item_type,item_id);

create index if not exists aseel_epg_channel_time_idx on public.aseel_epg_programs(channel_id,starts_at,ends_at);

create index if not exists aseel_playback_reports_date_idx on public.aseel_playback_reports(status,created_at desc);

create index if not exists aseel_playback_reports_owner_idx on public.aseel_playback_reports(user_id);

create index if not exists aseel_stream_checks_date_idx on public.aseel_stream_check_results(item_type,item_id,checked_at desc);

create index if not exists aseel_import_jobs_status_idx on public.aseel_import_jobs(status,created_at desc);

create index if not exists aseel_import_job_items_job_idx on public.aseel_import_job_items(job_id,status);

create index if not exists aseel_admin_audit_logs_date_idx on public.aseel_admin_audit_logs(created_at desc);

create index if not exists aseel_subtitle_tracks_media_idx on public.aseel_subtitle_tracks(media_type,media_id);

create index if not exists aseel_offline_downloads_owner_idx on public.aseel_offline_downloads(user_id,state);

create index if not exists aseel_device_sessions_owner_idx on public.aseel_device_sessions(user_id,last_seen_at desc);

create index if not exists aseel_notifications_unread_idx on public.aseel_notifications(user_id,created_at desc) where read_at is null;