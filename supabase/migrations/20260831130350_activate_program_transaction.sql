create or replace function public.activate_program(
  p_program_id uuid,
  p_affiliate_url text,
  p_terms_url text,
  p_commission_type text,
  p_commission_value numeric,
  p_recurring boolean,
  p_cookie_duration_days integer,
  p_countries text[],
  p_verified_by text,
  p_verification_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_program public.programs%rowtype;
  v_referral_link public.referral_links%rowtype;
  v_notes jsonb;
  v_country text;
  v_normalized_countries text[] := array[]::text[];
begin
  if p_program_id is null then
    raise exception 'program_id is required';
  end if;

  if p_affiliate_url is null or p_affiliate_url !~* '^https://[^[:space:]]+$' then
    raise exception 'affiliate_url must be an HTTPS URL';
  end if;

  if p_terms_url is null or p_terms_url !~* '^https://[^[:space:]]+$' then
    raise exception 'terms_url must be an HTTPS URL';
  end if;

  if p_commission_type is null or p_commission_type not in (
    'percentage',
    'fixed',
    'cpa',
    'cpl',
    'revenue_share'
  ) then
    raise exception 'Unsupported commission_type';
  end if;

  if p_commission_value is null or p_commission_value < 0 then
    raise exception 'commission_value must be non-negative';
  end if;

  if p_commission_type in ('percentage', 'revenue_share')
    and p_commission_value > 100 then
    raise exception 'Percentage commission_value cannot exceed 100';
  end if;

  if p_recurring is null then
    raise exception 'recurring is required';
  end if;

  if p_cookie_duration_days is null
    or p_cookie_duration_days < 0
    or p_cookie_duration_days > 3650 then
    raise exception 'cookie_duration_days must be between 0 and 3650';
  end if;

  if p_countries is null or cardinality(p_countries) = 0 then
    raise exception 'countries must contain at least one country';
  end if;

  foreach v_country in array p_countries loop
    v_country := upper(btrim(v_country));

    if v_country !~ '^[A-Z]{2}$' then
      raise exception 'Each country must be a two-letter country code';
    end if;

    if not (v_country = any(v_normalized_countries)) then
      v_normalized_countries := array_append(
        v_normalized_countries,
        v_country
      );
    end if;
  end loop;

  p_verified_by := btrim(p_verified_by);

  if p_verified_by is null
    or length(p_verified_by) = 0
    or length(p_verified_by) > 100 then
    raise exception 'verified_by must contain between 1 and 100 characters';
  end if;

  if p_verification_note is not null
    and length(p_verification_note) > 1000 then
    raise exception 'verification_note cannot exceed 1000 characters';
  end if;

  select *
  into v_program
  from public.programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'Program not found';
  end if;

  if v_program.status = 'rejected' then
    raise exception 'Rejected program cannot be activated';
  end if;

  begin
    v_notes := coalesce(v_program.notes::jsonb, '{}'::jsonb);
  exception
    when others then
      v_notes := jsonb_build_object(
        'legacy_note',
        v_program.notes
      );
  end;

  v_notes := v_notes || jsonb_build_object(
    'activation',
    jsonb_strip_nulls(
      jsonb_build_object(
        'verified_by', p_verified_by,
        'verified_at', statement_timestamp(),
        'verification_note', nullif(btrim(p_verification_note), '')
      )
    )
  );

  update public.programs
  set
    affiliate_url = p_affiliate_url,
    status = 'active',
    countries = to_jsonb(v_normalized_countries),
    commission_type = p_commission_type,
    commission_value = p_commission_value,
    recurring = p_recurring,
    cookie_duration_days = p_cookie_duration_days,
    terms_url = p_terms_url,
    terms_verified = true,
    last_verified_at = statement_timestamp(),
    notes = v_notes::text,
    updated_at = statement_timestamp()
  where id = p_program_id
  returning * into v_program;

  update public.referral_links
  set
    status = 'paused',
    updated_at = statement_timestamp()
  where program_id = p_program_id
    and status = 'active';

  insert into public.referral_links (
    program_id,
    name,
    url,
    source,
    placement,
    status
  )
  values (
    p_program_id,
    v_program.name || ' verified referral',
    p_affiliate_url,
    'verified_activation',
    'program_activation',
    'active'
  )
  on conflict on constraint referral_links_program_url_key
  do update set
    name = excluded.name,
    source = excluded.source,
    placement = excluded.placement,
    status = 'active',
    updated_at = statement_timestamp()
  returning * into v_referral_link;

  return jsonb_build_object(
    'program_id', v_program.id,
    'program_status', v_program.status,
    'terms_verified', v_program.terms_verified,
    'referral_link_id', v_referral_link.id,
    'referral_link_status', v_referral_link.status,
    'affiliate_url', v_program.affiliate_url,
    'verified_by', p_verified_by
  );
end;
$$;

revoke all on function public.activate_program(
  uuid,
  text,
  text,
  text,
  numeric,
  boolean,
  integer,
  text[],
  text,
  text
) from public;

revoke all on function public.activate_program(
  uuid,
  text,
  text,
  text,
  numeric,
  boolean,
  integer,
  text[],
  text,
  text
) from anon, authenticated;

grant execute on function public.activate_program(
  uuid,
  text,
  text,
  text,
  numeric,
  boolean,
  integer,
  text[],
  text,
  text
) to service_role, postgres;
