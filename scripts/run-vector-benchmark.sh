#!/usr/bin/env bash
set -euo pipefail

: "${CHEFIT_DIAGNOSTIC_KEY:?Set CHEFIT_DIAGNOSTIC_KEY first}"

BASE_URL="${CHEFIT_BASE_URL:-http://localhost:3000}"
OUT_DIR="benchmark-results/vector-$(date +%Y%m%d-%H%M%S)"
CSV="$OUT_DIR/summary.csv"

mkdir -p "$OUT_DIR"

echo "timestamp,label,question,max_results,ranker,rewrite_query,trace_id,vector_search_ms,generation_ms,route_total_ms,top_file,top_score,answer" > "$CSV"

run_case() {
  local qlabel="$1"
  local question="$2"
  local preset="$3"
  local max_results="$4"
  local ranker="$5"
  local rewrite_query="$6"

  local label="${qlabel}_${preset}"
  local json_file="$OUT_DIR/${label}.json"

  payload=$(python3 - "$question" "$max_results" "$ranker" "$rewrite_query" <<'PY'
import json
import sys

question, max_results, ranker, rewrite_query = sys.argv[1:]

print(json.dumps({
    "question": question,
    "maxResults": int(max_results),
    "ranker": ranker,
    "rewriteQuery": rewrite_query.lower() == "true"
}))
PY
)

  echo "Running $label..."

  curl -s \
    -X POST "${BASE_URL}/api/performance/vector-diagnostic" \
    -H "Content-Type: application/json" \
    -H "X-ChefIt-Diagnostic-Key: ${CHEFIT_DIAGNOSTIC_KEY}" \
    -d "$payload" > "$json_file"

  python3 - "$CSV" "$label" "$question" "$max_results" "$ranker" "$rewrite_query" "$json_file" <<'PY'
import csv
import datetime
import json
import sys

csv_path, label, question, max_results, ranker, rewrite_query, json_file = sys.argv[1:]

with open(json_file) as f:
    data = json.load(f)

timings = data.get("timings", {})
top = (data.get("resultSummary") or [{}])[0] or {}
answer = (data.get("answer") or "").replace("\n", " ").strip()

row = [
    datetime.datetime.now().isoformat(timespec="seconds"),
    label,
    question,
    max_results,
    ranker,
    rewrite_query,
    data.get("traceId", ""),
    timings.get("vectorSearchMs", ""),
    timings.get("generationMs", ""),
    timings.get("routeTotalMs", ""),
    top.get("filename", ""),
    top.get("score", ""),
    answer,
]

with open(csv_path, "a", newline="") as f:
    csv.writer(f).writerow(row)

print(
    f"{label}: "
    f"vector={timings.get('vectorSearchMs')}ms "
    f"generation={timings.get('generationMs')}ms "
    f"total={timings.get('routeTotalMs')}ms "
    f"top={top.get('filename')} "
    f"score={top.get('score')}"
)
PY
}

QUESTIONS=(
  "medium_rare|What temperature is medium rare?"
  "triple_threat|What is the Triple Threat?"
  "triple_threat_wow|What is the Triple Threat from Wow Good Products?"
  "triple_threat_wild|What is the Triple Threat from Wild Good Products?"
  "food_cost|How can I reduce food costs at Jay's Diner?"
)

PRESETS=(
  "A_quality|5|auto|true"
  "B_smaller|3|auto|true"
  "C_fast|3|none|false"
  "D_minimal|2|none|false"
)

for qdef in "${QUESTIONS[@]}"; do
  IFS='|' read -r qlabel question <<< "$qdef"

  for pdef in "${PRESETS[@]}"; do
    IFS='|' read -r preset max_results ranker rewrite_query <<< "$pdef"

    run_case "$qlabel" "$question" "$preset" "$max_results" "$ranker" "$rewrite_query"
  done
done

echo ""
echo "Benchmark complete."
echo "Summary CSV:"
echo "$CSV"
echo ""
echo "Raw JSON folder:"
echo "$OUT_DIR"