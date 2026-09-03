alter table public.content
  add column source_content_id uuid,
  add column revision_number integer,
  add constraint content_revision_pair_check
    check (
      (source_content_id is null and revision_number is null)
      or
      (
        source_content_id is not null
        and revision_number is not null
      )
    ),
  add constraint content_revision_number_check
    check (
      revision_number is null
      or revision_number > 0
    ),
  add constraint content_revision_source_not_self_check
    check (
      source_content_id is null
      or source_content_id <> id
    ),
  add constraint content_source_content_id_fkey
    foreign key (source_content_id)
    references public.content (id)
    on delete restrict,
  add constraint content_source_revision_key
    unique (source_content_id, revision_number);