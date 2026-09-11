alter table public.referral_links
  add constraint referral_links_program_id_id_key
  unique (program_id, id);

alter table public.content
  add column program_id uuid,
  add column referral_link_id uuid,
  add column monetized_at timestamp with time zone,
  add constraint content_monetization_pair_check
    check (
      (program_id is null and referral_link_id is null)
      or
      (program_id is not null and referral_link_id is not null)
    ),
  add constraint content_program_id_fkey
    foreign key (program_id)
    references public.programs (id)
    on delete set null,
  add constraint content_program_referral_link_fkey
    foreign key (program_id, referral_link_id)
    references public.referral_links (program_id, id)
    on delete set null;

create index content_program_idx
  on public.content (program_id);

create index content_referral_link_idx
  on public.content (referral_link_id);
