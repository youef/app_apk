-- Al Ezz TV link health agent. Keep status=published and admin access unchanged.
-- Automatic blocking only after 3 repeated definitive failures.
DO $ddl$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['aseel_channels','aseel_movies','aseel_episodes','aseel_series']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS link_health_status text NOT NULL DEFAULT ''unchecked''', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS link_health_reason text', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS link_health_checked_at timestamptz', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS link_health_failures integer NOT NULL DEFAULT 0', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS link_health_url text', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (link_health_status IN (''unchecked'',''healthy'',''suspect'',''broken''))',tbl,tbl||'_link_health_status_check');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (link_health_checked_at ASC NULLS FIRST) WHERE status = ''published''',tbl||'_link_health_due_idx',tbl);
  END LOOP;
END $ddl$;

-- A corrected link becomes eligible for rechecking immediately.
CREATE OR REPLACE FUNCTION public.aseel_reset_link_health_on_edit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.stream_url IS DISTINCT FROM NEW.stream_url OR
    OLD.youtube_url IS DISTINCT FROM NEW.youtube_url OR
    CASE WHEN TG_TABLE_NAME = 'aseel_channels' THEN to_jsonb(OLD)->>'official_url' IS DISTINCT FROM to_jsonb(NEW)->>'official_url' ELSE false END OR
    to_jsonb(OLD)->'stream_variants' IS DISTINCT FROM to_jsonb(NEW)->'stream_variants'
  ) THEN
    NEW.link_health_status := 'unchecked';
    NEW.link_health_reason := NULL;
    NEW.link_health_checked_at := NULL;
    NEW.link_health_failures := 0;
    NEW.link_health_url := NULL;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER aseel_channels_reset_link_health BEFORE UPDATE ON public.aseel_channels FOR EACH ROW EXECUTE FUNCTION public.aseel_reset_link_health_on_edit();
CREATE TRIGGER aseel_movies_reset_link_health BEFORE UPDATE ON public.aseel_movies FOR EACH ROW EXECUTE FUNCTION public.aseel_reset_link_health_on_edit();
CREATE TRIGGER aseel_episodes_reset_link_health BEFORE UPDATE ON public.aseel_episodes FOR EACH ROW EXECUTE FUNCTION public.aseel_reset_link_health_on_edit();

-- Preserve every existing public read condition, adding one common visibility rule.
-- Existing admin policies remain untouched, so broken titles stay visible to the owner.
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename,policyname,qual
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('aseel_channels','aseel_movies','aseel_episodes','aseel_series')
      AND cmd = 'SELECT'
      AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles))
  LOOP
    IF p.qual NOT LIKE '%link_health_status%' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING ((%s) AND (link_health_status <> ''broken''))',
        p.policyname,p.tablename,p.qual
      );
    END IF;
  END LOOP;
END $policies$;
