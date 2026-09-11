-- Covers the composite foreign key content_program_referral_link_fkey.
-- Also supports joins and filters that identify a content record's
-- program/referral-link pair.
create index content_program_referral_link_idx
  on public.content (program_id, referral_link_id);
