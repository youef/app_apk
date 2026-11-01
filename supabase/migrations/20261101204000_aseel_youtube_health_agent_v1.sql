-- Extend link-health protection to the children's YouTube video directory.
ALTER TABLE public.aseel_youtube_videos ADD COLUMN IF NOT EXISTS link_health_status text NOT NULL DEFAULT 'unchecked';
ALTER TABLE public.aseel_youtube_videos ADD COLUMN IF NOT EXISTS link_health_reason text;
ALTER TABLE public.aseel_youtube_videos ADD COLUMN IF NOT EXISTS link_health_checked_at timestamptz;
ALTER TABLE public.aseel_youtube_videos ADD COLUMN IF NOT EXISTS link_health_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.aseel_youtube_videos ADD COLUMN IF NOT EXISTS link_health_url text;
ALTER TABLE public.aseel_youtube_videos ADD CONSTRAINT aseel_youtube_videos_link_health_status_check
  CHECK (link_health_status IN ('unchecked','healthy','suspect','broken'));
CREATE INDEX IF NOT EXISTS aseel_youtube_videos_link_health_due_idx
ON public.aseel_youtube_videos (link_health_checked_at ASC NULLS FIRST) WHERE status='published';

CREATE OR REPLACE FUNCTION public.aseel_reset_youtube_health_on_edit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.youtube_url IS DISTINCT FROM NEW.youtube_url THEN
    NEW.link_health_status := 'unchecked';
    NEW.link_health_reason := NULL;
    NEW.link_health_checked_at := NULL;
    NEW.link_health_failures := 0;
    NEW.link_health_url := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aseel_youtube_videos_reset_link_health
BEFORE UPDATE ON public.aseel_youtube_videos FOR EACH ROW
EXECUTE FUNCTION public.aseel_reset_youtube_health_on_edit();
ALTER POLICY aseel_youtube_videos_public_read ON public.aseel_youtube_videos
USING ((status='published' AND is_kids=true) AND link_health_status <> 'broken');
