import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { PERFORMANCE_CONFIG } from "@/lib/performance-config";

const CHEFIT_SYSTEM_PROMPT = `
You are the Chef-iT knowledge answer engine for Chef George.

Answer the guest using the Chef-iT knowledge base when relevant.

Rules:
- Give a concise, voice-friendly answer.
- Usually stay under 100 words.
- Start with the useful answer immediately.
- Do not mention files, retrieval, databases, tools, or internal systems.
- Do not say "according to the knowledge base."
- If the retrieved information is insufficient, say so briefly and do not guess.
- For Chef-iT, Chasing The Flames, Wow Gooooood!!! Products, sponsors, recipes, restaurant operations, and food-cost questions, rely on retrieved context when available.
- For common stable culinary facts, answer plainly and practically.
- Keep the tone warm, natural, and helpful.

Safety:
Do not provide medical advice, legal advice, dangerous instructions, explicit sexual content, or offensive content.
For account, billing, or support issues, direct the guest to Chef-iT support.
`;

type ServiceSpan = {
  trace_id: string;
  service: string;
  operation: string;
  duration_ms: number;
  status: "success" | "error";
  model?: string;
  environment: "local" | "production";
  monitor_version: string;
  benchmark_version: string;
  prompt_version: string;
  knowledge_version: string;
  voice_version: string;
  avatar_version: string;
  metadata?: Record<string, unknown>;
};

function nowMs() {
  return performance.now();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function getEnvironment(): "local" | "production" {
  return process.env.VERCEL_ENV === "production" ? "production" : "local";
}

async function persistServiceSpans(spans: ServiceSpan[]) {
  if (!spans.length) return;

  const { error } = await supabase
    .from("performance_service_spans")
    .insert(spans);

  if (error) {
    console.error("[Chef Ask Timing Persist Error]", error);
  }
}

function buildSpan(params: {
  traceId: string;
  service: string;
  operation: string;
  durationMs: number;
  status?: "success" | "error";
  model?: string;
  metadata?: Record<string, unknown>;
}): ServiceSpan {
  return {
    trace_id: params.traceId,
    service: params.service,
    operation: params.operation,
    duration_ms: Math.max(0, Math.round(params.durationMs)),
    status: params.status || "success",
    model: params.model,
    environment: getEnvironment(),
    monitor_version: PERFORMANCE_CONFIG.monitorVersion,
    benchmark_version: PERFORMANCE_CONFIG.benchmarkVersion,
    prompt_version: PERFORMANCE_CONFIG.promptVersion,
    knowledge_version: PERFORMANCE_CONFIG.knowledgeVersion,
    voice_version: PERFORMANCE_CONFIG.voiceVersion,
    avatar_version: PERFORMANCE_CONFIG.avatarVersion,
    metadata: params.metadata || {},
  };
}

export async function POST(req: Request) {
  const traceId =
    req.headers.get("x-chefit-trace-id") ||
    crypto.randomUUID();

  const routeStartedAt = nowMs();

  const spans: ServiceSpan[] = [];

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
    const model = process.env.OPENAI_MODEL || "gpt-5.5";

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    if (!vectorStoreId) {
      return NextResponse.json(
        { error: "Missing OPENAI_VECTOR_STORE_ID" },
        { status: 500 }
      );
    }

    const parseStartedAt = nowMs();
    const { question } = await req.json();
    const parseMs = elapsedMs(parseStartedAt);

    spans.push(
      buildSpan({
        traceId,
        service: "vercel",
        operation: "request_parse",
        durationMs: parseMs,
        model,
        metadata: {
          route: "/api/chef/ask",
        },
      })
    );

    if (!question || typeof question !== "string") {
      spans.push(
        buildSpan({
          traceId,
          service: "vercel",
          operation: "route_total",
          durationMs: elapsedMs(routeStartedAt),
          status: "error",
          model,
          metadata: {
            route: "/api/chef/ask",
            error: "Missing question",
          },
        })
      );

      await persistServiceSpans(spans);

      return NextResponse.json(
        { error: "Missing question" },
        {
          status: 400,
          headers: {
            "X-ChefIt-Trace-Id": traceId,
          },
        }
      );
    }

    const openai = new OpenAI({ apiKey });

    const openAIStartedAt = nowMs();

    const response = await openai.responses.create({
      model,
      input: [
        {
          role: "system",
          content: CHEFIT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: question,
        },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId],
        },
      ],
    });

    const openAITotalMs = elapsedMs(openAIStartedAt);

    const answer = response.output_text || "";

    spans.push(
      buildSpan({
        traceId,
        service: "openai",
        operation: "responses_file_search_total",
        durationMs: openAITotalMs,
        model,
        metadata: {
          route: "/api/chef/ask",
          question_chars: question.length,
          answer_chars: answer.length,
          vector_store_configured: Boolean(vectorStoreId),
        },
      })
    );

    const routeTotalMs = elapsedMs(routeStartedAt);

    spans.push(
      buildSpan({
        traceId,
        service: "vercel",
        operation: "chef_ask_route_total",
        durationMs: routeTotalMs,
        model,
        metadata: {
          route: "/api/chef/ask",
          question_chars: question.length,
          answer_chars: answer.length,
          openai_total_ms: openAITotalMs,
          parse_ms: parseMs,
        },
      })
    );

    console.log("[Chef Ask Timing]", {
      traceId,
      routeTotalMs,
      openAITotalMs,
      parseMs,
      model,
      questionChars: question.length,
      answerChars: answer.length,
    });

    await persistServiceSpans(spans);

    return NextResponse.json(
      {
        answer,
      },
      {
        headers: {
          "X-ChefIt-Trace-Id": traceId,
          "X-ChefIt-Route-Total-Ms": String(routeTotalMs),
          "X-ChefIt-OpenAI-Total-Ms": String(openAITotalMs),
        },
      }
    );
  } catch (error) {
    console.error("[Chef Ask Error]", error);

    const routeTotalMs = elapsedMs(routeStartedAt);

    spans.push(
      buildSpan({
        traceId,
        service: "vercel",
        operation: "chef_ask_route_total",
        durationMs: routeTotalMs,
        status: "error",
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        metadata: {
          route: "/api/chef/ask",
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },
      })
    );

    await persistServiceSpans(spans);

    return NextResponse.json(
      { error: "Chef-it knowledge request failed" },
      {
        status: 500,
        headers: {
          "X-ChefIt-Trace-Id": traceId,
        },
      }
    );
  }
}