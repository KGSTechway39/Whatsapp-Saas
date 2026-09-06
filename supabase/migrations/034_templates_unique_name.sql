-- =====================================================
-- 034_templates_unique_name.sql — one template per (tenant, name, language)
--
-- WHY: `templates` had only a PRIMARY KEY on id. Any upsert using
-- `onConflict: 'user_id,name'` therefore had no constraint to match and failed
-- silently — a starter template was successfully created at Meta while the
-- local row was never written, so the app showed nothing after a successful
-- submission.
--
-- The key mirrors Meta's own rule: a template is unique by name + language
-- within a WhatsApp Business Account. Language is part of it because the same
-- template legitimately exists in several languages.
--
-- Also protects against a double-click creating two rows for one Meta template.
--
-- ADDITIVE & SAFE; idempotent. Deduplicates first so the index can be built on
-- databases that already accumulated duplicates.
-- =====================================================

-- Keep the newest row per (user_id, name, language); drop older duplicates.
-- Prefers a row that carries meta_template_id — that one is the real one.
DELETE FROM public.templates t
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, name, language
           ORDER BY (meta_template_id IS NOT NULL) DESC, updated_at DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM public.templates
) d
WHERE t.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_user_name_lang
  ON public.templates(user_id, name, language);
