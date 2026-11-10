set local lock_timeout = '3s';

-- Keep unapproved streams visible only to active catalogue administrators.
-- Existing permissive policies still decide which approved or external rows are public.
create policy aseel_channels_anon_rights_guard
on public.aseel_channels as restrictive for select to anon
using (
    status = 'published'
    and (
      rights_status = 'approved'
      or (
        rights_status = 'pending' and playback_mode = 'official_link'
        and stream_url is null and youtube_url is null
      )
    )
);

create policy aseel_channels_customer_rights_guard
on public.aseel_channels as restrictive for select to authenticated
using (
  (select exists (
    select 1 from public.aseel_admins
    where user_id = (select auth.uid()) and active
  ))
  or (
    status = 'published'
    and (
      rights_status = 'approved'
      or (
        rights_status = 'pending' and playback_mode = 'official_link'
        and stream_url is null and youtube_url is null
      )
    )
  )
);
