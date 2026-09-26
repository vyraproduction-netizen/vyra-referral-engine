alter table public.analytics_events
  add column dedupe_key text,
  add constraint analytics_events_dedupe_key_length_check
    check (
      dedupe_key is null
      or char_length(dedupe_key) between 1 and 200
    ),
  add constraint analytics_events_dedupe_key_key
    unique (dedupe_key);
