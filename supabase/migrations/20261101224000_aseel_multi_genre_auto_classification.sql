-- AL EZZ: additive multi-genre classification, preserves existing category_id and RLS.
ALTER TABLE public.aseel_movies
  ADD COLUMN IF NOT EXISTS genre_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS auto_tags text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.aseel_series
  ADD COLUMN IF NOT EXISTS genre_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS auto_tags text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.aseel_episodes
  ADD COLUMN IF NOT EXISTS genre_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS auto_tags text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.aseel_channels
  ADD COLUMN IF NOT EXISTS genre_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS auto_tags text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Existing category_id remains unchanged; admins may add multiple manual tags.
CREATE OR REPLACE FUNCTION public.aseel_infer_genres(
  p_title text, p_original text, p_description text, p_category uuid, p_kids boolean
) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $fn$
DECLARE
  text_blob text;
  category_name text;
  labels text[] := ARRAY[]::text[];
BEGIN
  SELECT c.name_ar INTO category_name FROM public.aseel_categories c WHERE c.id = p_category;
  text_blob := lower(concat_ws(' ', p_title, p_original, p_description, category_name));
  IF coalesce(p_kids, false) THEN labels := array_append(labels, 'kids'); END IF;
  IF text_blob ~* 'اكشن|أكشن|action|قتال|مطارد' THEN labels := array_append(labels, 'action'); END IF;
  IF text_blob ~* 'مغامر|adventure|رحلة استكشاف' THEN labels := array_append(labels, 'adventure'); END IF;
  IF text_blob ~* 'كرتون|رسوم متحرك|cartoon|animation|animated' THEN labels := array_append(labels, 'animation'); END IF;
  IF text_blob ~* 'أنمي|انمي|anime' THEN labels := array_append(labels, 'anime'); END IF;
  IF text_blob ~* 'سيرة ذاتية|biography|biopic' THEN labels := array_append(labels, 'biography'); END IF;
  IF text_blob ~* 'كوميد|comedy|comedic' THEN labels := array_append(labels, 'comedy'); END IF;
  IF text_blob ~* 'جريم|crime|criminal|مافيا|بوليسي|تحقيق جنائي|detective' THEN labels := array_append(labels, 'crime'); END IF;
  IF text_blob ~* 'وثائق|documentary|docuseries' THEN labels := array_append(labels, 'documentary'); END IF;
  IF text_blob ~* 'دراما|drama|dramatic' THEN labels := array_append(labels, 'drama'); END IF;
  IF text_blob ~* 'تعليم|education|educational' THEN labels := array_append(labels, 'education'); END IF;
  IF text_blob ~* 'عائل|family' THEN labels := array_append(labels, 'family'); END IF;
  IF text_blob ~* 'فانتاز|خيال|fantasy' THEN labels := array_append(labels, 'fantasy'); END IF;
  IF text_blob ~* 'تاريخ|historical|history' THEN labels := array_append(labels, 'history'); END IF;
  IF text_blob ~* 'رعب|horror' THEN labels := array_append(labels, 'horror'); END IF;
  IF text_blob ~* 'أطفال|اطفال|kids|children' THEN labels := array_append(labels, 'kids'); END IF;
  IF text_blob ~* 'غموض|mystery' THEN labels := array_append(labels, 'mystery'); END IF;
  IF text_blob ~* 'طبيعة|nature|wildlife|الحياة البرية' THEN labels := array_append(labels, 'nature'); END IF;
  IF text_blob ~* 'رومانس|رومنسي|romance|romantic|عاطفي' THEN labels := array_append(labels, 'romance'); END IF;
  IF text_blob ~* 'خيال علمي|science fiction|sci-fi|scifi' THEN labels := array_append(labels, 'scifi'); END IF;
  IF text_blob ~* 'علمي|علوم|science' THEN labels := array_append(labels, 'science'); END IF;
  IF text_blob ~* 'قصير|short film|short movie' THEN labels := array_append(labels, 'short'); END IF;
  IF text_blob ~* 'رياض|sport|sports' THEN labels := array_append(labels, 'sports'); END IF;
  IF text_blob ~* 'اثار|إثار|تشويق|thriller|suspense' THEN labels := array_append(labels, 'thriller'); END IF;
  IF text_blob ~* 'حرب|حروب|عسكري|warfare|war film|military' THEN labels := array_append(labels, 'war'); END IF;
  IF text_blob ~* 'ويسترن|western' THEN labels := array_append(labels, 'western'); END IF;
  IF text_blob ~* 'موسيقى|موسيقي|musical|music' THEN labels := array_append(labels, 'music'); END IF;
  IF text_blob ~* 'كلاسيك|classic|صامت' THEN labels := array_append(labels, 'classic'); END IF;
  RETURN coalesce((SELECT array_agg(DISTINCT tag ORDER BY tag) FROM unnest(labels) AS tag), ARRAY[]::text[]);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.aseel_media_auto_tags()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  NEW.auto_tags := public.aseel_infer_genres(
    NEW.title_ar, NEW.title_original, NEW.description, NEW.category_id, NEW.is_kids
  );
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.aseel_channel_auto_tags()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  NEW.auto_tags := public.aseel_infer_genres(NEW.title_ar, NULL, NEW.description, NEW.category_id, NEW.is_kids);
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.aseel_episode_auto_tags()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
DECLARE
  inherited text[] := ARRAY[]::text[];
  own_tags text[];
BEGIN
  SELECT coalesce(s.auto_tags, ARRAY[]::text[]) || coalesce(s.genre_tags, ARRAY[]::text[])
  INTO inherited
  FROM public.aseel_seasons season
  JOIN public.aseel_series s ON s.id = season.series_id
  WHERE season.id = NEW.season_id;
  own_tags := public.aseel_infer_genres(NEW.title_ar, NULL, NEW.description, NULL, FALSE);
  NEW.auto_tags := coalesce((
     SELECT array_agg(DISTINCT tag ORDER BY tag)
     FROM unnest(coalesce(inherited, ARRAY[]::text[]) || own_tags) AS tag
  ), ARRAY[]::text[]);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS aseel_movies_auto_tags_trigger ON public.aseel_movies;
CREATE TRIGGER aseel_movies_auto_tags_trigger BEFORE INSERT OR UPDATE
ON public.aseel_movies FOR EACH ROW EXECUTE FUNCTION public.aseel_media_auto_tags();

DROP TRIGGER IF EXISTS aseel_series_auto_tags_trigger ON public.aseel_series;
CREATE TRIGGER aseel_series_auto_tags_trigger BEFORE INSERT OR UPDATE
ON public.aseel_series FOR EACH ROW EXECUTE FUNCTION public.aseel_media_auto_tags();

DROP TRIGGER IF EXISTS aseel_channels_auto_tags_trigger ON public.aseel_channels;
CREATE TRIGGER aseel_channels_auto_tags_trigger BEFORE INSERT OR UPDATE
ON public.aseel_channels FOR EACH ROW EXECUTE FUNCTION public.aseel_channel_auto_tags();

DROP TRIGGER IF EXISTS aseel_episodes_auto_tags_trigger ON public.aseel_episodes;
CREATE TRIGGER aseel_episodes_auto_tags_trigger BEFORE INSERT OR UPDATE
ON public.aseel_episodes FOR EACH ROW EXECUTE FUNCTION public.aseel_episode_auto_tags();

-- When a series is reclassified, its existing episodes inherit the updated tags.
CREATE OR REPLACE FUNCTION public.aseel_refresh_episode_genres()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF NEW.auto_tags IS DISTINCT FROM OLD.auto_tags OR NEW.genre_tags IS DISTINCT FROM OLD.genre_tags THEN
    UPDATE public.aseel_episodes e
       SET auto_tags = e.auto_tags
     WHERE e.season_id IN (SELECT se.id FROM public.aseel_seasons se WHERE se.series_id = NEW.id);
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS aseel_refresh_episode_genres_trigger ON public.aseel_series;
CREATE TRIGGER aseel_refresh_episode_genres_trigger AFTER UPDATE OF title_ar,title_original,description,category_id,is_kids,genre_tags,auto_tags
ON public.aseel_series FOR EACH ROW EXECUTE FUNCTION public.aseel_refresh_episode_genres();

INSERT INTO public.aseel_categories (name_ar,sort_order,published)
SELECT v.name_ar,v.sort_order,true
FROM (VALUES
  ('أكشن', 101),
  ('مغامرة', 102),
  ('أنيمي', 103),
  ('كرتون', 104),
  ('وثائقي', 105),
  ('جريمة', 106),
  ('حرب', 107),
  ('تاريخي', 108),
  ('سيرة ذاتية', 109),
  ('عائلي', 110),
  ('أطفال', 111),
  ('خيال علمي', 112),
  ('فانتازيا', 113),
  ('غموض وتشويق', 114),
  ('رومانسي', 115),
  ('دراما اجتماعية', 116),
  ('كوميديا سوداء', 117),
  ('رياضة', 118),
  ('موسيقي', 119),
  ('تعليمي', 120),
  ('طبيعة وحياة برية', 121),
  ('تحقيقات', 122),
  ('سياسي', 123),
  ('مغامرات فضائية', 124),
  ('خيال', 125),
  ('أفلام ومسلسلات قصيرة', 126),
  ('ويسترن', 127),
  ('كلاسيكيات', 128),
  ('مسلسلات تاريخية', 129),
  ('أفلام وثائقية', 130)
) AS v(name_ar,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.aseel_categories c WHERE lower(trim(c.name_ar))=lower(trim(v.name_ar)));

-- Reclassify existing rows without changing titles, links, rights, publishing or category_id.
UPDATE public.aseel_movies SET auto_tags = public.aseel_infer_genres(title_ar,title_original,description,category_id,is_kids);
UPDATE public.aseel_series SET auto_tags = public.aseel_infer_genres(title_ar,title_original,description,category_id,is_kids);
UPDATE public.aseel_channels SET auto_tags = public.aseel_infer_genres(title_ar,NULL,description,category_id,is_kids);
UPDATE public.aseel_episodes SET auto_tags = auto_tags;

CREATE INDEX IF NOT EXISTS aseel_movies_auto_tags_idx ON public.aseel_movies USING gin (auto_tags);
CREATE INDEX IF NOT EXISTS aseel_series_auto_tags_idx ON public.aseel_series USING gin (auto_tags);
CREATE INDEX IF NOT EXISTS aseel_movies_genre_tags_idx ON public.aseel_movies USING gin (genre_tags);
CREATE INDEX IF NOT EXISTS aseel_series_genre_tags_idx ON public.aseel_series USING gin (genre_tags);

COMMENT ON COLUMN public.aseel_movies.genre_tags IS 'Manual, editable multi-genre tags; auto_tags is inferred from metadata';
COMMENT ON COLUMN public.aseel_series.genre_tags IS 'Manual, editable multi-genre tags; episodes inherit both';
COMMENT ON COLUMN public.aseel_episodes.auto_tags IS 'Inferred from episode and parent series metadata';
REVOKE ALL ON FUNCTION public.aseel_infer_genres(text,text,text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aseel_infer_genres(text,text,text,uuid,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.aseel_media_auto_tags() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aseel_channel_auto_tags() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aseel_episode_auto_tags() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aseel_refresh_episode_genres() FROM PUBLIC;
