-- Required for upsert on shape_archive_notes.external_id
alter table public.shape_archive_notes
  drop constraint if exists shape_archive_notes_external_id_key;

create unique index if not exists shape_archive_notes_external_id_key
  on public.shape_archive_notes (external_id)
  where external_id is not null;
