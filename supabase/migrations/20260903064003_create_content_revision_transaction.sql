alter table public.content
  add column revision_job_id uuid,
  add constraint content_revision_job_pair_check
    check (
      (source_content_id is null and revision_job_id is null)
      or
      (source_content_id is not null and revision_job_id is not null)
    ),
  add constraint content_revision_job_id_fkey
    foreign key (revision_job_id)
    references public.jobs (id)
    on delete restrict,
  add constraint content_revision_job_id_key
    unique (revision_job_id);

create or replace function public.create_content_revision(
  p_revision_job_id uuid,
  p_source_content_id uuid,
  p_referral_link_id uuid,
  p_title text,
  p_slug text,
  p_body text,
  p_excerpt text,
  p_meta_title text,
  p_meta_description text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_source public.content%rowtype;
  v_existing public.content%rowtype;
  v_revision public.content%rowtype;
  v_revision_number integer;
begin
  if p_revision_job_id is null then
    raise exception 'Revision job id is required';
  end if;

  if p_source_content_id is null then
    raise exception 'Source content id is required';
  end if;

  if p_referral_link_id is null then
    raise exception 'Referral link id is required';
  end if;

  if nullif(btrim(p_title), '') is null then
    raise exception 'Revision title is required';
  end if;

  if nullif(btrim(p_slug), '') is null then
    raise exception 'Revision slug is required';
  end if;

  if nullif(btrim(p_body), '') is null then
    raise exception 'Revision body is required';
  end if;

  if nullif(btrim(p_excerpt), '') is null then
    raise exception 'Revision excerpt is required';
  end if;

  if nullif(btrim(p_meta_title), '') is null then
    raise exception 'Revision meta title is required';
  end if;

  if nullif(btrim(p_meta_description), '') is null then
    raise exception 'Revision meta description is required';
  end if;

  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Revision evidence must be an object';
  end if;

  select *
  into v_job
  from public.jobs
  where id = p_revision_job_id;

  if not found then
    raise exception 'Revision job not found';
  end if;

  if v_job.agent <> 'content'
     or v_job.task_type <> 'content_revision' then
    raise exception 'Invalid revision job contract';
  end if;

  select *
  into v_existing
  from public.content
  where revision_job_id = p_revision_job_id;

  if found then
    if v_existing.source_content_id <> p_source_content_id
       or v_existing.referral_link_id <> p_referral_link_id
       or v_existing.slug <> btrim(p_slug) then
      raise exception 'Revision job id collision';
    end if;

    return jsonb_build_object(
      'id', v_existing.id,
      'slug', v_existing.slug,
      'status', v_existing.status,
      'source_content_id', v_existing.source_content_id,
      'revision_number', v_existing.revision_number,
      'revision_job_id', v_existing.revision_job_id,
      'created', false
    );
  end if;

  select *
  into v_source
  from public.content
  where id = p_source_content_id
  for update;

  if not found then
    raise exception 'Revision source content not found';
  end if;

  if v_source.status <> 'published' then
    raise exception 'Revision source must be published';
  end if;

  if nullif(btrim(v_source.body), '') is null then
    raise exception 'Revision source body is required';
  end if;

  if v_source.program_id is null then
    raise exception 'Revision source program is required';
  end if;

  if v_source.referral_link_id is distinct from p_referral_link_id then
    raise exception 'Revision referral link mismatch';
  end if;

  select *
  into v_existing
  from public.content
  where revision_job_id = p_revision_job_id;

  if found then
    if v_existing.source_content_id <> p_source_content_id
       or v_existing.referral_link_id <> p_referral_link_id
       or v_existing.slug <> btrim(p_slug) then
      raise exception 'Revision job id collision';
    end if;

    return jsonb_build_object(
      'id', v_existing.id,
      'slug', v_existing.slug,
      'status', v_existing.status,
      'source_content_id', v_existing.source_content_id,
      'revision_number', v_existing.revision_number,
      'revision_job_id', v_existing.revision_job_id,
      'created', false
    );
  end if;

  select coalesce(max(revision_number), 0) + 1
  into v_revision_number
  from public.content
  where source_content_id = p_source_content_id;

  insert into public.content (
    topic_id,
    title,
    slug,
    content_type,
    language,
    status,
    body,
    excerpt,
    meta_title,
    meta_description,
    evidence,
    program_id,
    referral_link_id,
    source_content_id,
    revision_number,
    revision_job_id
  )
  values (
    v_source.topic_id,
    btrim(p_title),
    btrim(p_slug),
    'article',
    v_source.language,
    'draft',
    p_body,
    btrim(p_excerpt),
    btrim(p_meta_title),
    btrim(p_meta_description),
    p_evidence,
    v_source.program_id,
    p_referral_link_id,
    p_source_content_id,
    v_revision_number,
    p_revision_job_id
  )
  returning * into v_revision;

  return jsonb_build_object(
    'id', v_revision.id,
    'slug', v_revision.slug,
    'status', v_revision.status,
    'source_content_id', v_revision.source_content_id,
    'revision_number', v_revision.revision_number,
    'revision_job_id', v_revision.revision_job_id,
    'created', true
  );
end;
$$;

revoke all on function public.create_content_revision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.create_content_revision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;
