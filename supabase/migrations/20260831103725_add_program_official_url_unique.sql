alter table public.programs
  add constraint programs_official_url_key
  unique (official_url);