alter table public.referral_links
  add constraint referral_links_program_url_key
  unique (program_id, url);