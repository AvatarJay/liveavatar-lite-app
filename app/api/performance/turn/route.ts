import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_CATEGORIES = new Set([
  "conversation",
  "product",
  "restaurant",
  "culinary",
  "other",
  "unclassified",
]);

const ALLOWED_ENVIRONMENTS = new Set(["local", "preview", "production"]);

type SegmentTiming = {
  segmentNumber: number;
  responseEventMs: number | null;
  speechStartedMs: number | null;
  speechEndedMs: number | null;
  speechDurationMs: number | null;
  gapFromPreviousSegmentMs: number | null;
};

type PerformanceTurnRequest = {
  eventId: string;
  sessionId: string | null;
  customerEmail: string | null;
  turnNumber: number;
  questionCategory: string;
  segmentCount: number;
  firstSpeechMs: number | null;
  firstSpeechDurationMs: number | null;
  postAcknowledgmentGapMs: number | null;
  substantiveAnswerStartMs: number | null;
  secondSpeechDurationMs: number | null;
  segmentTimings: SegmentTiming[];
  monitorVersion: string;
  benchmarkVersion: string;
  promptVersion: string;
  knowledgeVersion: string;
  voiceVersion: string;
  avatarVersion: string;
  environment: string;
  clientCompletedAt: string;
};

function isNullableNonNegativeInteger(value: unknown) {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

function isShortString(value: unknown, maxLength = 120) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isNullableShortString(value: unknown, maxLength = 320) {
  return (
    value === null || (typeof value === "string" && value.length <= maxLength)
  );
}

function isSegmentTiming(value: unknown): value is SegmentTiming {
  if (!value || typeof value !== "object") {
    return false;
  }

  const segment = value as Record<string, unknown>;

  return (
    typeof segment.segmentNumber === "number" &&
    Number.isInteger(segment.segmentNumber) &&
    segment.segmentNumber > 0 &&
    isNullableNonNegativeInteger(segment.responseEventMs) &&
    isNullableNonNegativeInteger(segment.speechStartedMs) &&
    isNullableNonNegativeInteger(segment.speechEndedMs) &&
    isNullableNonNegativeInteger(segment.speechDurationMs) &&
    isNullableNonNegativeInteger(segment.gapFromPreviousSegmentMs)
  );
}

function validateRequest(body: PerformanceTurnRequest) {
  if (!UUID_PATTERN.test(body.eventId)) {
    return "Invalid eventId";
  }

  if (!isNullableShortString(body.sessionId, 200)) {
    return "Invalid sessionId";
  }

  if (!isNullableShortString(body.customerEmail, 320)) {
    return "Invalid customerEmail";
  }

  if (!Number.isInteger(body.turnNumber) || body.turnNumber < 1) {
    return "Invalid turnNumber";
  }

  if (!ALLOWED_CATEGORIES.has(body.questionCategory)) {
    return "Invalid questionCategory";
  }

  if (!Number.isInteger(body.segmentCount) || body.segmentCount < 1) {
    return "Invalid segmentCount";
  }

  if (!Array.isArray(body.segmentTimings)) {
    return "Invalid segmentTimings";
  }

  if (
    body.segmentTimings.length !== body.segmentCount ||
    !body.segmentTimings.every(isSegmentTiming)
  ) {
    return "Segment timing count or values are invalid";
  }

  const metrics = [
    body.firstSpeechMs,
    body.firstSpeechDurationMs,
    body.postAcknowledgmentGapMs,
    body.substantiveAnswerStartMs,
    body.secondSpeechDurationMs,
  ];

  if (!metrics.every(isNullableNonNegativeInteger)) {
    return "One or more latency values are invalid";
  }

  const versions = [
    body.monitorVersion,
    body.benchmarkVersion,
    body.promptVersion,
    body.knowledgeVersion,
    body.voiceVersion,
    body.avatarVersion,
  ];

  if (!versions.every((value) => isShortString(value))) {
    return "One or more version labels are invalid";
  }

  if (!ALLOWED_ENVIRONMENTS.has(body.environment)) {
    return "Invalid environment";
  }

  if (Number.isNaN(Date.parse(body.clientCompletedAt))) {
    return "Invalid clientCompletedAt";
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PerformanceTurnRequest;
    const validationError = validateRequest(body);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { error } = await supabase.from("performance_turns").upsert(
      {
        event_id: body.eventId,
        session_id: body.sessionId,
        customer_email: body.customerEmail,
        turn_number: body.turnNumber,
        question_category: body.questionCategory,
        segment_count: body.segmentCount,
        first_speech_ms: body.firstSpeechMs,
        first_speech_duration_ms: body.firstSpeechDurationMs,
        post_acknowledgment_gap_ms: body.postAcknowledgmentGapMs,
        substantive_answer_start_ms: body.substantiveAnswerStartMs,
        second_speech_duration_ms: body.secondSpeechDurationMs,
        segment_timings: body.segmentTimings,
        monitor_version: body.monitorVersion,
        benchmark_version: body.benchmarkVersion,
        prompt_version: body.promptVersion,
        knowledge_version: body.knowledgeVersion,
        voice_version: body.voiceVersion,
        avatar_version: body.avatarVersion,
        environment: body.environment,
        client_completed_at: body.clientCompletedAt,
      },
      {
        onConflict: "event_id",
      },
    );

    if (error) {
      console.error("[Performance Persistence Error]", error);
      return NextResponse.json(
        { error: "Failed to store performance turn" },
        { status: 500 },
      );
    }

    return NextResponse.json({ stored: true, eventId: body.eventId });
  } catch (error) {
    console.error("[Performance Persistence Unexpected Error]", error);
    return NextResponse.json(
      { error: "Invalid performance request" },
      { status: 400 },
    );
  }
}
