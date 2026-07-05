-- Audit corrupted article translations before regenerating EN/AR.
-- Scope:
-- - Only content_translations rows for articles.
-- - Only short/medium public fields.
-- - Never deletes body translations, articles, slugs, images, or French source fields.

with suspicious_article_translations as (
  select
    id,
    table_name,
    row_id,
    field,
    language,
    status,
    source_text_hash,
    char_length(value_text) as value_length,
    left(value_text, 500) as value_preview,
    created_at,
    updated_at
  from public.content_translations
  where table_name = 'articles'
    and field in ('title', 'excerpt', 'category', 'meta_title', 'meta_description', 'cover_alt')
    and value_text is not null
    and (
      value_text like '%<%'
      or value_text like '%>%'
      or value_text ilike '%dir=%'
      or value_text ilike '%style=%'
      or (field = 'title' and char_length(value_text) > 140)
      or (field = 'meta_title' and char_length(value_text) > 120)
      or (field = 'category' and char_length(value_text) > 50)
      or (field = 'excerpt' and char_length(value_text) > 400)
      or (field = 'meta_description' and char_length(value_text) > 300)
    )
)
select *
from suspicious_article_translations
order by field, language, updated_at desc nulls last, created_at desc nulls last;

-- After reviewing the SELECT result above, run this targeted DELETE to remove only
-- corrupted short/medium translations. Then regenerate EN + AR from Admin > Traductions.
--
-- with suspicious_article_translations as (
--   select id
--   from public.content_translations
--   where table_name = 'articles'
--     and field in ('title', 'excerpt', 'category', 'meta_title', 'meta_description', 'cover_alt')
--     and value_text is not null
--     and (
--       value_text like '%<%'
--       or value_text like '%>%'
--       or value_text ilike '%dir=%'
--       or value_text ilike '%style=%'
--       or (field = 'title' and char_length(value_text) > 140)
--       or (field = 'meta_title' and char_length(value_text) > 120)
--       or (field = 'category' and char_length(value_text) > 50)
--       or (field = 'excerpt' and char_length(value_text) > 400)
--       or (field = 'meta_description' and char_length(value_text) > 300)
--     )
-- )
-- delete from public.content_translations
-- where id in (select id from suspicious_article_translations)
-- returning id, table_name, row_id, field, language, status, left(value_text, 500) as deleted_preview;
