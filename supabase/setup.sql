-- AXIA feedback loop: database setup for Supabase.
-- Run once: Supabase dashboard → SQL Editor → New query → paste this file → Run.

-- One row per upload session (a "case"). No names, files or report text are stored.
create table if not exists public.cases (
  id           text primary key,              -- random id made in the browser per upload
  created_at   timestamptz not null default now(),
  consent      boolean not null default false,
  body_part    text,
  sequence     text,
  plane        text,
  source       text,                          -- "dicom" or "image"
  slice_count  integer
);

-- One row per verdict on an AI answer.
create table if not exists public.feedback (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  case_id         text not null references public.cases(id) on delete cascade,
  ai_type         text not null check (ai_type in ('spot','map_label','scene','read_observation')),
  ai_output       jsonb,                      -- exactly what the AI said
  ai_via          text,                       -- "claude" (claude.ai) or "backend" (your API key)
  model_tier      text,                       -- quick / default / complex
  prompt_version  text,                       -- PROMPT_VERSION in index.html
  verdict         text not null check (verdict in ('correct','wrong')),
  correction      text,                       -- "what is it actually?"
  reviewer_role   text not null default 'patient' check (reviewer_role in ('patient','clinician')),
  review_status   text not null default 'unverified' check (review_status in ('unverified','verified','rejected')),
  reviewed_at     timestamptz,
  reviewer_note   text,
  slice_index     integer,
  spot            jsonb,                      -- {"x":0.42,"y":0.61} as fractions of the image
  image_path      text                        -- path in the private "feedback-crops" bucket
);

create index if not exists feedback_case_idx   on public.feedback (case_id);
create index if not exists feedback_status_idx on public.feedback (review_status, created_at desc);

-- Lock the tables: only the server function (service_role key) can read or write.
-- No policies are created, so the public "anon" key gets no access at all.
alter table public.cases    enable row level security;
alter table public.feedback enable row level security;

-- Private storage bucket for the 256 px image crops.
insert into storage.buckets (id, name, public)
values ('feedback-crops', 'feedback-crops', false)
on conflict (id) do nothing;

-- Review queue: unverified feedback, newest first, with the case context.
create or replace view public.review_queue with (security_invoker = true) as
  select f.id, f.created_at, c.body_part, c.sequence, c.plane, f.ai_type,
         f.ai_output, f.verdict, f.correction, f.reviewer_role, f.image_path
  from public.feedback f join public.cases c on c.id = f.case_id
  where f.review_status = 'unverified'
  order by f.created_at desc;

-- First numbers for week 3: how often each kind of answer is judged correct.
create or replace view public.accuracy_by_type with (security_invoker = true) as
  select ai_type, prompt_version, review_status,
         count(*) as answers,
         round(100.0 * avg(case when verdict = 'correct' then 1 else 0 end), 1) as pct_correct
  from public.feedback
  group by ai_type, prompt_version, review_status
  order by ai_type, prompt_version;

-- Keep the views private too (they are for you, in the dashboard).
revoke all on public.review_queue, public.accuracy_by_type from anon, authenticated;
