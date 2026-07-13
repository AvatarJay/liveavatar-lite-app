create table if not exists public.performance_turns (
  event_id uuid primary key,
  created_at timestamptz not null default now(),
  client_completed_at timestamptz not null,

  session_id text,
  customer_email text,
  turn_number integer not null check (turn_number > 0),
  question_category text not null default 'unclassified'
    check (
      question_category in (
        'conversation',
        'product',
        'restaurant',
        'culinary',
        'other',
        'unclassified'
      )
    ),

  segment_count integer not null check (segment_count > 0),
  first_speech_ms integer check (first_speech_ms is null or first_speech_ms >= 0),
  first_speech_duration_ms integer
    check (first_speech_duration_ms is null or first_speech_duration_ms >= 0),
  post_acknowledgment_gap_ms integer
    check (post_acknowledgment_gap_ms is null or post_acknowledgment_gap_ms >= 0),
  substantive_answer_start_ms integer
    check (substantive_answer_start_ms is null or substantive_answer_start_ms >= 0),
  second_speech_duration_ms integer
    check (second_speech_duration_ms is null or second_speech_duration_ms >= 0),

  segment_timings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(segment_timings) = 'array'),

  monitor_version text not null,
  benchmark_version text not null,
  prompt_version text not null,
  knowledge_version text not null,
  voice_version text not null,
  avatar_version text not null,
  environment text not null
    check (environment in ('local', 'preview', 'production'))
);

create index if not exists performance_turns_created_at_idx
  on public.performance_turns (created_at desc);

create index if not exists performance_turns_session_id_idx
  on public.performance_turns (session_id);

create index if not exists performance_turns_benchmark_version_idx
  on public.performance_turns (benchmark_version);

create index if not exists performance_turns_question_category_idx
  on public.performance_turns (question_category);

alter table public.performance_turns enable row level security;

revoke all on table public.performance_turns from anon, authenticated;
grant select, insert, update on table public.performance_turns to service_role;

comment on table public.performance_turns is
  'Turn-level Chef-iT performance measurements. Stores timing and version metadata only; no question or response text.';
