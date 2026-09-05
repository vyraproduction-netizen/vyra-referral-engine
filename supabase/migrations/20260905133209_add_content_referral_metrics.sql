create table public.content_referral_metrics (
  content_id uuid not null,
  referral_link_id uuid not null,
  clicks integer not null default 0,
  conversions integer not null default 0,
  revenue numeric(12, 2) not null default 0,
  last_click_at timestamp with time zone,
  last_conversion_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint content_referral_metrics_pkey
    primary key (content_id, referral_link_id),
  constraint content_referral_metrics_content_id_fkey
    foreign key (content_id)
    references public.content (id)
    on delete cascade,
  constraint content_referral_metrics_referral_link_id_fkey
    foreign key (referral_link_id)
    references public.referral_links (id)
    on delete cascade,
  constraint content_referral_metrics_clicks_check
    check (clicks >= 0),
  constraint content_referral_metrics_conversions_check
    check (conversions >= 0 and conversions <= clicks),
  constraint content_referral_metrics_revenue_check
    check (revenue >= 0)
);

create index content_referral_metrics_referral_link_idx
  on public.content_referral_metrics (referral_link_id);

alter table public.content_referral_metrics
  enable row level security;

revoke all on table public.content_referral_metrics
  from anon, authenticated;

grant select, insert, update, delete
  on table public.content_referral_metrics
  to service_role;
