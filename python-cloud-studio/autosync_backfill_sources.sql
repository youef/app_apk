-- Seed source memory from URLs already stored against real content UUIDs.
-- This does not fetch media or declare any URL healthy. Discovery timestamps
-- default to the time of this backfill; no historical discovery time is invented.
-- Rerunnable: existing source rows, checks, statistics and timestamps are retained.
-- Run as a database owner/service role, or an authenticated active administrator.
begin;

with
original_pages as (
  select 'aseel_movies'::text as target_table,id as target_id,source_page_url
  from public.aseel_movies
  union all
  select 'aseel_series',id,source_page_url from public.aseel_series
  union all
  select 'aseel_episodes',id,source_page_url from public.aseel_episodes
),
media_rows as (
  select 'aseel_movies'::text as target_table,id as target_id,
         stream_url,source_page_url,stream_variants
  from public.aseel_movies
  union all
  select 'aseel_episodes',id,stream_url,source_page_url,stream_variants
  from public.aseel_episodes
),
candidates as (
  select target_table,target_id,source_page_url as source_url,
         'original'::text as source_kind,source_page_url as page_url,
         'المصدر الأصلي'::text as label,0 as priority
  from original_pages
  where length(source_page_url)<=2048
  union all
  select target_table,target_id,stream_url,
         case when stream_url ~* '[.](mp4|m4v|webm|m3u8)([?#]|$)'
              then 'direct' else 'embed' end,
         source_page_url,'الرابط الأساسي',1
  from media_rows
  union all
  select m.target_table,m.target_id,v.item->>'url',
         case when (v.item->>'url') ~* '[.](mp4|m4v|webm|m3u8)([?#]|$)'
              then 'direct' else 'embed' end,
         case when (v.item->>'page_url') ~ '^https://[^[:space:]]+$'
                        and length(v.item->>'page_url')<=2048
              then v.item->>'page_url' else m.source_page_url end,
         coalesce(nullif(btrim(v.item->>'label'),''),'رابط بديل'),2
  from media_rows m
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(m.stream_variants)='array'
         then m.stream_variants else '[]'::jsonb end
  ) as v(item)
  where jsonb_typeof(v.item)='object'
    and jsonb_typeof(v.item->'url')='string'
),
valid_candidates as (
  select target_table,target_id,source_url,source_kind,
         case when page_url ~ '^https://[^[:space:]]+$' and length(page_url)<=2048
              then page_url else null end as page_url,
         left(coalesce(label,''),120) as label,priority
  from candidates
  where source_url ~ '^https://[^[:space:]]+$'
    and length(source_url)<=8192
),
deduplicated as (
  -- A URL appearing as both the original and a playback URL keeps its original
  -- classification. Identity is the exact URL and the content table plus UUID.
  select distinct on(target_table,target_id,source_url)
         target_table,target_id,source_url,source_kind,page_url,label
  from valid_candidates
  order by target_table,target_id,source_url,priority,label
),
inserted as (
  insert into public.aseel_media_sources
    (target_table,target_id,source_url,source_kind,page_url,label,status)
  select target_table,target_id,source_url,source_kind,page_url,label,'unchecked'
  from deduplicated
  on conflict(target_table,target_id,source_key) do nothing
  returning target_table,source_kind
)
select target_table,source_kind,count(*) as inserted_sources
from inserted
group by target_table,source_kind
order by target_table,source_kind;

commit;
