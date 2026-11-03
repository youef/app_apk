-- Run in the same transaction as autosync_schema.sql with its BEGIN/COMMIT removed.
-- This script ends with ROLLBACK and never commits test sources or schema changes.

create temporary table autosync_test_guard as
select md5(string_agg(id::text||status||rights_status,',' order by id)) checksum
from (select id,status,rights_status from public.aseel_movies union all
select id,status,rights_status from public.aseel_series union all
select id,status,rights_status from public.aseel_episodes) x;
select set_config('autosync.test_target',(select id::text from public.aseel_movies order by id limit 1),true);
select set_config('autosync.test_admin',(select user_id::text from public.aseel_admins where active order by user_id limit 1),true);
do $test$
begin
 if not (has_table_privilege('service_role','public.aseel_media_sources','SELECT')
 and has_table_privilege('service_role','public.aseel_media_sources','INSERT')
 and has_table_privilege('service_role','public.aseel_media_sources','UPDATE'))
 then raise exception 'service_role CRUD grants missing'; end if;
 if has_table_privilege('service_role','public.aseel_media_sources','DELETE')
 or has_table_privilege('anon','public.aseel_media_sources','SELECT')
 then raise exception 'History too broadly accessible'; end if;
end $test$;
set local role service_role;
insert into public.aseel_media_sources(target_table,target_id,source_url,source_kind,first_seen_at,last_seen_at)
values('aseel_movies',current_setting('autosync.test_target')::uuid,
'https://autosync.example.org/test-history.m3u8','direct','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');
insert into public.aseel_media_sources(target_table,target_id,source_url,source_kind,first_seen_at,last_seen_at,label)
values('aseel_movies',current_setting('autosync.test_target')::uuid,
'https://autosync.example.org/test-history.m3u8','direct',now(),now(),'second discovery')
on conflict(target_table,target_id,source_key) do update
set first_seen_at=excluded.first_seen_at,last_seen_at=excluded.last_seen_at,label=excluded.label;
do $test$
declare n integer; first_seen timestamptz; digest_key text;
begin
 select count(*),min(first_seen_at),min(source_key) into n,first_seen,digest_key
 from public.aseel_media_sources where source_url='https://autosync.example.org/test-history.m3u8';
 if n<>1 or first_seen<>'2026-01-01T00:00:00Z'::timestamptz
 or digest_key<>encode(extensions.digest('https://autosync.example.org/test-history.m3u8','sha256'),'hex')
 then raise exception 'Deduplication or immutable discovery timestamp failed'; end if;
 begin
  insert into public.aseel_media_sources(target_table,target_id,source_url,source_kind)
  values('aseel_movies',gen_random_uuid(),'https://autosync.example.org/wrong-id.mp4','direct');
  raise exception 'Missing UUID target was accepted';
 exception when foreign_key_violation then null; end;
 begin
  update public.aseel_media_sources set source_url='https://autosync.example.org/reassigned.mp4'
  where source_url='https://autosync.example.org/test-history.m3u8';
  raise exception 'Mutable source identity was accepted';
 exception when check_violation then null; end;
end $test$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
set local role authenticated;
do $test$
begin
 if exists(select 1 from public.aseel_media_sources) then raise exception 'Non-admin can read source memory'; end if;
 begin
  insert into public.aseel_media_sources(target_table,target_id,source_url,source_kind)
  values('aseel_movies',current_setting('autosync.test_target')::uuid,'https://autosync.example.org/non-admin.mp4','direct');
  raise exception 'Non-admin can write source memory';
 exception when insufficient_privilege or foreign_key_violation then null; end;
end $test$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('autosync.test_admin'),'role','authenticated')::text,true);
set local role authenticated;
do $test$
begin
 if not exists(select 1 from public.aseel_media_sources where source_url='https://autosync.example.org/test-history.m3u8')
 then raise exception 'Active administrator cannot read source memory'; end if;
 insert into public.aseel_media_sources(target_table,target_id,source_url,source_kind)
 values('aseel_movies',current_setting('autosync.test_target')::uuid,'https://autosync.example.org/alternate-original','original');
 update public.aseel_media_sources set successes=1,confidence=0.75
 where source_url='https://autosync.example.org/test-history.m3u8';
end $test$;
reset role;
do $test$
begin
 if (select checksum from autosync_test_guard) is distinct from
 (select md5(string_agg(id::text||status||rights_status,',' order by id))
 from (select id,status,rights_status from public.aseel_movies union all
 select id,status,rights_status from public.aseel_series union all
 select id,status,rights_status from public.aseel_episodes) x)
 then raise exception 'Publication or rights changed'; end if;
end $test$;
rollback;
select jsonb_build_object('rollback_verified',true,'persistent_source_table_exists',to_regclass('public.aseel_media_sources') is not null) as verification;

