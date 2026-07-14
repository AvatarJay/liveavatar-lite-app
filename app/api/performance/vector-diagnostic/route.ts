import OpenAI from "openai";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { PERFORMANCE_CONFIG } from "@/lib/performance-config";

const CHEFIT_SYSTEM_PROMPT = `
You are Chef George, the On-Call Outdoor Chef for Chef-it.

You are friendly, groovy, concise, and expert in outdoor cooking, live fire, restaurant operations, menu costing, and culinary education.

Use the provided retrieved context when answering culinary, restaurant, recipe, grilling, barbecue, costing, conversion, or kitchen-management questions.

Voice response rules:
- Default to 2 short paragraphs maximum.
- Usually stay under 120 words.
- Start with the useful answer immediately.
- Do not over-explain unless the user asks for details.
- Avoid long lists unless necessary.
- Use "groovy" naturally, but not in every sentence.
- Do not repeat the Chef-it branding line in every answer.
- Mention Chef-it only when it feels natural or useful.
- For recipes, title them starting with "Groovy".
- Emphasize live-fire safety and heat-zone management when relevant.

Pronunciation style:
- degrees should be spoken as DEE-GREEZ.
- chile should be spoken as CHIL-LEE.
- Binchotan should be spoken as BIN-CHO-TAN.
- Maillard should be spoken as MY-YARD.

Safety:
Do not provide medical advice, explicit sexual content, or offensive content.
For account issues, direct users to support.
`;

type Environment = "local" | "production";
type SpanStatus = "success" | "error";

type ServiceSpan = {
  trace_id: string;
  service: string;
  operation: string;
  duration_ms: number;
  status: SpanStatus;
  model?: string;
  environment: Environment;
  monitor_version: string;
  benchmark_version: string;
  prompt_version: string;
  knowledge_version: string;
  voice_version: string;
  avatar_version: string;
  metadata?: Record<string, unknown>;
};

type DiagnosticRequest = {
  question?: unknown;
  maxResults?: unknown;
  maxContextChars?: unknown;
  ranker?: unknown;
  rewriteQuery?: unknown;
};

type VectorSearchContent = {
  type?: string;
  text?: string;
};

type VectorSearchResult = {
  file_id?: string;
  filename?: string;
  score?: number;
  content?: VectorSearchContent[];
};

type VectorSearchResponse = {
  object?: string;
  search_query?: string | string[];
  data?: VectorSearchResult[];
  has_more?: boolean;
  next_page?: string | null;
};

function nowMs() {
  return performance.now();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function getEnvironment(): Environment {
  return process.env.VERCEL_ENV === "production"
    ? "production"
    : "local";
}

function isAuthorized(req: Request) {
  const expected = process.env.PERFORMANCE_DIAGNOSTIC_KEY;
  const isProduction = process.env.VERCEL_ENV === "production";

  if (!expected && isProduction) {
    return false;
  }

  if (!expected) {
    return true;
  }

  return req.headers.get("x-chefit-diagnostic-key") === expected;
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  const numericValue =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;

  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

function normalizeRanker(value: unknown) {
  if (
    value === "none" ||
    value === "auto" ||
    value === "default-2024-11-15"
  ) {
    return value;
  }

  return "auto";
}

function buildSpan(params: {
  traceId: string;
  service: string;
  operation: string;
  durationMs: number;
  status?: SpanStatus;
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

async function persistServiceSpans(spans: ServiceSpan[]) {
  if (!spans.length) return;

  const { error } = await supabase
    .from("performance_service_spans")
    .insert(spans);

  if (error) {
    console.error("[Vector Diagnostic Timing Persist Error]", error);
  }
}

function getResultText(result: VectorSearchResult) {
  return (result.content || [])
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildRetrievedContext(
  results: VectorSearchResult[],
  maxContextChars: number
) {
  let context = "";

  for (const [index, result] of results.entries()) {
    const text = getResultText(result);

    if (!text) continue;

    const block = [
      `Source ${index + 1}`,
      `Filename: ${result.filename || "unknown"}`,
      `Score: ${
        typeof result.score === "number"
          ? result.score.toFixed(4)
          : "unknown"
      }`,
      "",
      text,
    ].join("\n");

    if (context.length + block.length > maxContextChars) {
      const remaining = maxContextChars - context.length;

      if (remaining > 200) {
        context += `\n\n${block.slice(0, remaining)}`;
      }

      break;
    }

    context += context ? `\n\n---\n\n${block}` : block;
  }

  return context.trim();
}

function summarizeResults(results: VectorSearchResult[]) {
  return results.map((result) => ({
    fileId: result.file_id || null,
    filename: result.filename || null,
    score:
      typeof result.score === "number"
        ? Number(result.score.toFixed(4))
        : null,
    textChars: getResultText(result).length,
  }));
}

export async function POST(req: Request) {
  const traceId =
    req.headers.get("x-chefit-trace-id") || crypto.randomUUID();

  const routeStartedAt = nowMs();
  const spans: ServiceSpan[] = [];

  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { error: "Unauthorized diagnostic request" },
        { status: 401 }
      );
    }

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
    const body = (await req.json()) as DiagnosticRequest;
    const parseMs = elapsedMs(parseStartedAt);

    spans.push(
      buildSpan({
        traceId,
        service: "vercel",
        operation: "diagnostic_request_parse",
        durationMs: parseMs,
        model,
        metadata: {
          route: "/api/performance/vector-diagnostic",
        },
      })
    );

    const question =
      typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      spans.push(
        buildSpan({
          traceId,
          service: "vercel",
          operation: "vector_diagnostic_route_total",
          durationMs: elapsedMs(routeStartedAt),
          status: "error",
          model,
          metadata: {
            route: "/api/performance/vector-diagnostic",
            error: "Missing question",
          },
        })
      );

      await persistServiceSpans(spans);

      return NextResponse.json(
        { error: "Missing question" },
        { status: 400 }
      );
    }

    const maxResults = normalizeNumber(body.maxResults, 5, 1, 20);
    const maxContextChars = normalizeNumber(
      body.maxContextChars,
      6000,
      1000,
      20000
    );
    const ranker = normalizeRanker(body.ranker);
    const rewriteQuery =
      typeof body.rewriteQuery === "boolean" ? body.rewriteQuery : true;

    const vectorStartedAt = nowMs();

    const vectorResponse = await fetch(
      `https://api.openai.com/v1/vector_stores/${encodeURIComponent(
        vectorStoreId
      )}/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: question,
          max_num_results: maxResults,
          ranking_options: {
            ranker,
          },
          rewrite_query: rewriteQuery,
        }),
      }
    );

    const vectorSearchMs = elapsedMs(vectorStartedAt);

    if (!vectorResponse.ok) {
      const errorText = await vectorResponse.text();

      spans.push(
        buildSpan({
          traceId,
          service: "openai",
          operation: "vector_store_search",
          durationMs: vectorSearchMs,
          status: "error",
          model,
          metadata: {
            route: "/api/performance/vector-diagnostic",
            http_status: vectorResponse.status,
            error: errorText.slice(0, 500),
            max_results: maxResults,
            ranker,
            rewrite_query: rewriteQuery,
          },
        })
      );

      spans.push(
        buildSpan({
          traceId,
          service: "vercel",
          operation: "vector_diagnostic_route_total",
          durationMs: elapsedMs(routeStartedAt),
          status: "error",
          model,
          metadata: {
            route: "/api/performance/vector-diagnostic",
            vector_search_ms: vectorSearchMs,
          },
        })
      );

      await persistServiceSpans(spans);

      return NextResponse.json(
        {
          error: "Vector Store search failed",
          traceId,
          status: vectorResponse.status,
        },
        { status: 502 }
      );
    }

    const vectorJson =
      (await vectorResponse.json()) as VectorSearchResponse;

    const results = vectorJson.data || [];
    const retrievedContext = buildRetrievedContext(
      results,
      maxContextChars
    );
    const resultSummary = summarizeResults(results);

    spans.push(
      buildSpan({
        traceId,
        service: "openai",
        operation: "vector_store_search",
        durationMs: vectorSearchMs,
        model,
        metadata: {
          route: "/api/performance/vector-diagnostic",
          result_count: results.length,
          max_results: maxResults,
          max_context_chars: maxContextChars,
          context_chars: retrievedContext.length,
          ranker,
          rewrite_query: rewriteQuery,
          has_more: Boolean(vectorJson.has_more),
          top_score:
            typeof results[0]?.score === "number"
              ? Number(results[0].score.toFixed(4))
              : null,
          top_files: resultSummary.slice(0, 5).map((item) => ({
            filename: item.filename,
            score: item.score,
            textChars: item.textChars,
          })),
        },
      })
    );

    const openai = new OpenAI({ apiKey });

    const generationStartedAt = nowMs();

    const generationResponse = await openai.responses.create({
      model,
      input: [
        {
          role: "system",
          content: CHEFIT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            "Answer the guest using the retrieved context below.",
            "If the retrieved context does not contain reliable information, say so clearly and do not guess.",
            "Keep the answer concise and natural for voice.",
            "",
            `Guest question: ${question}`,
            "",
            "Retrieved context:",
            retrievedContext || "(No retrieved context returned.)",
          ].join("\n"),
        },
      ],
    });

    const generationMs = elapsedMs(generationStartedAt);
    const answer = generationResponse.output_text || "";

    spans.push(
      buildSpan({
        traceId,
        service: "openai",
        operation: "manual_context_generation",
        durationMs: generationMs,
        model,
        metadata: {
          route: "/api/performance/vector-diagnostic",
          question_chars: question.length,
          context_chars: retrievedContext.length,
          answer_chars: answer.length,
          result_count: results.length,
        },
      })
    );

    const routeTotalMs = elapsedMs(routeStartedAt);

    spans.push(
      buildSpan({
        traceId,
        service: "vercel",
        operation: "vector_diagnostic_route_total",
        durationMs: routeTotalMs,
        model,
        metadata: {
          route: "/api/performance/vector-diagnostic",
          vector_search_ms: vectorSearchMs,
          generation_ms: generationMs,
          parse_ms: parseMs,
          result_count: results.length,
          context_chars: retrievedContext.length,
          answer_chars: answer.length,
          max_results: maxResults,
          ranker,
          rewrite_query: rewriteQuery,
        },
      })
    );

    console.log("[Vector Diagnostic Timing]", {
      traceId,
      routeTotalMs,
      vectorSearchMs,
      generationMs,
      resultCount: results.length,
      contextChars: retrievedContext.length,
      answerChars: answer.length,
      maxResults,
      ranker,
      rewriteQuery,
    });

    await persistServiceSpans(spans);

    return NextResponse.json({
      traceId,
      answer,
      timings: {
        vectorSearchMs,
        generationMs,
        routeTotalMs,
      },
      parameters: {
        maxResults,
        maxContextChars,
        ranker,
        rewriteQuery,
      },
      resultSummary,
    });
  } catch (error) {
    console.error("[Vector Diagnostic Error]", error);

    const routeTotalMs = elapsedMs(routeStartedAt);

    spans.push(
      buildSpan({
        traceId,
        service: "vercel",
        operation: "vector_diagnostic_route_total",
        durationMs: routeTotalMs,
        status: "error",
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        metadata: {
          route: "/api/performance/vector-diagnostic",
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },
      })
    );

    await persistServiceSpans(spans);

    return NextResponse.json(
      {
        error: "Vector diagnostic request failed",
        traceId,
      },
      { status: 500 }
    );
  }
}