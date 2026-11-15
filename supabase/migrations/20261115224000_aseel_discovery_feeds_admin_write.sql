-- Only active Al Ezz TV administrators may manage discovery feeds.
-- Database migration also applied to smart-tv-plus on 2026-11-15.
ALTER TABLE public.aseel_studio_discovery_feeds ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE public.aseel_studio_discovery_feeds TO authenticated;

DROP POLICY IF EXISTS aseel_discovery_feeds_active_admin_insert ON public.aseel_studio_discovery_feeds;
CREATE POLICY aseel_discovery_feeds_active_admin_insert
ON public.aseel_studio_discovery_feeds FOR INSERT TO authenticated
WITH CHECK (
  (select auth.uid()) IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.aseel_admins a
              WHERE a.user_id=(select auth.uid()) AND a.active IS TRUE)
);

DROP POLICY IF EXISTS aseel_discovery_feeds_active_admin_update ON public.aseel_studio_discovery_feeds;
CREATE POLICY aseel_discovery_feeds_active_admin_update
ON public.aseel_studio_discovery_feeds FOR UPDATE TO authenticated
USING (
  (select auth.uid()) IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.aseel_admins a
              WHERE a.user_id=(select auth.uid()) AND a.active IS TRUE)
)
WITH CHECK (
  (select auth.uid()) IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.aseel_admins a
              WHERE a.user_id=(select auth.uid()) AND a.active IS TRUE)
);
