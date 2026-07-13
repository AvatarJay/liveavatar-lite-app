"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Room, RoomEvent, RemoteTrack } from "livekit-client";
import { PERFORMANCE_CONFIG } from "@/lib/performance-config";

const SESSION_SECONDS = 5 * 60;

const sponsors = [
  { name: "State Farm Agent Marty Saiz", logo: "/marty-saiz.jpg" },
  { name: "Turbo Threads", logo: "/turbo-threads.jpg" },
  { name: "Reytek", logo: "/reytek.jpg" },
];

type TranscriptEntry = {
  speaker: "User" | "Chef George" | "System";
  text: string;
  timestamp: string;
};

type ResponseSegment = {
  segmentNumber: number;
  responseText: string;
  responseEventAt: number | null;
  speechStartedAt: number | null;
  speechEndedAt: number | null;
};

type TurnPerformance = {
  eventId: string;
  turnNumber: number;
  questionText: string;
  questionReceivedAt: number | null;
  segments: ResponseSegment[];
  reported: boolean;
};

type LastUserTranscript = {
  normalizedText: string;
  receivedAt: number;
};

type PerformanceSegmentPayload = {
  segmentNumber: number;
  responseEventMs: number | null;
  speechStartedMs: number | null;
  speechEndedMs: number | null;
  speechDurationMs: number | null;
  gapFromPreviousSegmentMs: number | null;
};

type PerformanceTurnPayload = {
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
  segmentTimings: PerformanceSegmentPayload[];
  monitorVersion: string;
  benchmarkVersion: string;
  promptVersion: string;
  knowledgeVersion: string;
  voiceVersion: string;
  avatarVersion: string;
  environment: "local" | "production";
  clientCompletedAt: string;
};

export default function AvatarPage() {
  const [showSessionComplete, setShowSessionComplete] = useState(false);
  const [customerEmail, setCustomerEmail] = useState("");
  const [status, setStatus] = useState("Ready");
  const [room, setRoom] = useState<Room | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showSponsor, setShowSponsor] = useState(false);
  const [currentSponsor, setCurrentSponsor] = useState(sponsors[0]);
  const [videoKey, setVideoKey] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(SESSION_SECONDS);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isEmailing, setIsEmailing] = useState(false);
  const [showMicCheck, setShowMicCheck] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState("");
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [transcriptEmail, setTranscriptEmail] = useState("");
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState("");

  const trackedSessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const perfStartRef = useRef<number>(0);

  const turnPerformanceRef = useRef<TurnPerformance>({
    eventId: "",
    turnNumber: 0,
    questionText: "",
    questionReceivedAt: null,
    segments: [],
    reported: false,
  });

  const lastUserTranscriptRef = useRef<LastUserTranscript>({
    normalizedText: "",
    receivedAt: 0,
  });

  function perfLog(label: string) {
    const elapsed = perfStartRef.current
      ? `${Date.now() - perfStartRef.current}ms`
      : "0ms";

    console.log(`[Perf] ${label}: ${elapsed}`);
  }

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const timerColor =
    room && timeRemaining <= 60
      ? "bg-red-600 text-white scale-125 animate-pulse shadow-lg"
      : "bg-black/65 text-white";

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  function stopMicCheck() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    animationRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    setMicLevel(0);
  }

  async function beginMicCheck() {
    perfStartRef.current = Date.now();
    perfLog("Start Session clicked");
    setShowMicCheck(true);
    setMicReady(false);
    setMicError("");
    setStatus("Checking microphone...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      source.connect(analyser);
      analyser.fftSize = 256;

      const animate = () => {
        analyser.getByteFrequencyData(dataArray);

        const average =
          dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;

        const level = Math.min(100, Math.round(average * 2.5));

        setMicLevel(level);

        if (level > 8) {
          setMicReady(true);
        }

        animationRef.current = requestAnimationFrame(animate);
      };

      animate();
    } catch (error) {
      console.error("[Mic Check Error]", error);
      setMicError(
        "We could not access your microphone. Please allow microphone access in your browser, then try again.",
      );
      setStatus("Microphone access needed.");
    }
  }

  async function continueAfterMicCheck() {
    perfLog("Microphone check complete");
    stopMicCheck();
    setShowMicCheck(false);
    await startAvatar();
  }

  function cancelMicCheck() {
    stopMicCheck();
    setShowMicCheck(false);
    setMicReady(false);
    setStatus("Ready");
  }

  function addTranscriptEntry(
    speaker: TranscriptEntry["speaker"],
    text: string,
  ) {
    if (!text || !text.trim()) {
      return;
    }

    const cleanText = text.trim();

    setTranscript((current) => {
      const lastEntry = current[current.length - 1];

      if (
        lastEntry &&
        lastEntry.speaker === speaker &&
        lastEntry.text === cleanText
      ) {
        return current;
      }

      return [
        ...current,
        {
          speaker,
          text: cleanText,
          timestamp: new Date().toLocaleTimeString(),
        },
      ];
    });
  }

  function buildTranscriptText(entries: TranscriptEntry[]) {
    return [
      "CHEF-IT SESSION TRANSCRIPT",
      `Date: ${new Date().toLocaleString()}`,
      "",
      ...entries.map(
        (entry) => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`,
      ),
    ].join("\n");
  }

  async function startSessionTracking(sponsorName: string) {
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsorName,
          customerEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("[Session Tracking Start Failed]", data);
        return null;
      }

      return data.sessionId as string;
    } catch (error) {
      console.error("[Session Tracking Start Error]", error);
      return null;
    }
  }

  async function endSessionTracking() {
    const sessionId = trackedSessionIdRef.current;
    const startedAt = sessionStartedAtRef.current;

    if (!sessionId || !startedAt) {
      return;
    }

    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - startedAt) / 1000),
    );

    try {
      const res = await fetch("/api/sessions/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          durationSeconds,
          transcript: buildTranscriptText(transcriptRef.current),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error("[Session Tracking End Failed]", res.status, body);
      }
    } catch (error) {
      console.error("[Session Tracking End Error]", error);
    } finally {
      trackedSessionIdRef.current = null;
      sessionStartedAtRef.current = null;
    }
  }

  function formatPerformanceMs(value: number | null) {
    return value === null ? "Unavailable" : `${Math.round(value)} ms`;
  }

  function formatResponseEventTiming(
    responseEventAt: number | null,
    speechStartedAt: number | null,
  ) {
    if (responseEventAt === null || speechStartedAt === null) {
      return "Unavailable";
    }

    const difference = responseEventAt - speechStartedAt;

    if (Math.abs(difference) < 1) {
      return "Same time";
    }

    if (difference > 0) {
      return `${Math.round(difference)} ms after speech began`;
    }

    return `${Math.round(Math.abs(difference))} ms before speech began`;
  }

  function normalizeTranscriptForPerformance(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function shouldIgnoreDuplicateUserTranscript(value: string) {
    const normalizedText = normalizeTranscriptForPerformance(value);
    const now = performance.now();
    const previous = lastUserTranscriptRef.current;

    const isDuplicate =
      normalizedText === previous.normalizedText &&
      now - previous.receivedAt < 2500;

    if (isDuplicate) {
      return true;
    }

    lastUserTranscriptRef.current = {
      normalizedText,
      receivedAt: now,
    };

    return false;
  }

  function roundPerformanceMs(value: number | null) {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(0, Math.round(value));
  }

  function classifyPerformanceQuestion(questionText: string) {
    const normalized = normalizeTranscriptForPerformance(questionText);

    if (
      /\b(thank|thanks|bye|goodbye|hello|hey george|how are you|how you doing|that'?s it|nope)\b/.test(
        normalized,
      )
    ) {
      return "conversation";
    }

    if (
      /\b(triple threat|wow good|wild good|asado|fire cabinet|wind guard|hand washing station)\b/.test(
        normalized,
      )
    ) {
      return "product";
    }

    if (
      /\b(restaurant|diner|food cost|menu cost|inventory|supplier|portion|waste|staff|profit)\b/.test(
        normalized,
      )
    ) {
      return "restaurant";
    }

    if (
      /\b(cook|cooking|recipe|temperature|steak|beef|pork|chicken|grill|smoker|oven|fire|wood|charcoal)\b/.test(
        normalized,
      )
    ) {
      return "culinary";
    }

    return "other";
  }

  function getPerformanceEnvironment(): "local" | "production" {
    return process.env.NODE_ENV === "development" ? "local" : "production";
  }

  function buildPerformanceSegmentTimings(
    performanceTurn: TurnPerformance,
  ): PerformanceSegmentPayload[] {
    const questionReceivedAt = performanceTurn.questionReceivedAt;

    if (questionReceivedAt === null) {
      return [];
    }

    return performanceTurn.segments.map((segment, index) => {
      const previousSegment = performanceTurn.segments[index - 1];
      const previousSegmentEnd = previousSegment?.speechEndedAt ?? null;

      return {
        segmentNumber: segment.segmentNumber,
        responseEventMs: roundPerformanceMs(
          segment.responseEventAt !== null
            ? segment.responseEventAt - questionReceivedAt
            : null,
        ),
        speechStartedMs: roundPerformanceMs(
          segment.speechStartedAt !== null
            ? segment.speechStartedAt - questionReceivedAt
            : null,
        ),
        speechEndedMs: roundPerformanceMs(
          segment.speechEndedAt !== null
            ? segment.speechEndedAt - questionReceivedAt
            : null,
        ),
        speechDurationMs: roundPerformanceMs(
          segment.speechStartedAt !== null && segment.speechEndedAt !== null
            ? segment.speechEndedAt - segment.speechStartedAt
            : null,
        ),
        gapFromPreviousSegmentMs: roundPerformanceMs(
          previousSegmentEnd !== null && segment.speechStartedAt !== null
            ? segment.speechStartedAt - previousSegmentEnd
            : null,
        ),
      };
    });
  }

  function buildPerformanceTurnPayload(
    performanceTurn: TurnPerformance,
  ): PerformanceTurnPayload | null {
    const questionReceivedAt = performanceTurn.questionReceivedAt;

    if (
      !performanceTurn.eventId ||
      questionReceivedAt === null ||
      performanceTurn.segments.length === 0
    ) {
      return null;
    }

    const firstSegment = performanceTurn.segments[0];
    const secondSegment = performanceTurn.segments[1];

    return {
      eventId: performanceTurn.eventId,
      sessionId: trackedSessionIdRef.current,
      customerEmail: customerEmail.trim() || null,
      turnNumber: performanceTurn.turnNumber,
      questionCategory: classifyPerformanceQuestion(
        performanceTurn.questionText,
      ),
      segmentCount: performanceTurn.segments.length,
      firstSpeechMs: roundPerformanceMs(
        firstSegment?.speechStartedAt !== null &&
          firstSegment?.speechStartedAt !== undefined
          ? firstSegment.speechStartedAt - questionReceivedAt
          : null,
      ),
      firstSpeechDurationMs: roundPerformanceMs(
        firstSegment?.speechStartedAt !== null &&
          firstSegment?.speechStartedAt !== undefined &&
          firstSegment?.speechEndedAt !== null &&
          firstSegment?.speechEndedAt !== undefined
          ? firstSegment.speechEndedAt - firstSegment.speechStartedAt
          : null,
      ),
      postAcknowledgmentGapMs: roundPerformanceMs(
        firstSegment?.speechEndedAt !== null &&
          firstSegment?.speechEndedAt !== undefined &&
          secondSegment?.speechStartedAt !== null &&
          secondSegment?.speechStartedAt !== undefined
          ? secondSegment.speechStartedAt - firstSegment.speechEndedAt
          : null,
      ),
      substantiveAnswerStartMs: roundPerformanceMs(
        secondSegment?.speechStartedAt !== null &&
          secondSegment?.speechStartedAt !== undefined
          ? secondSegment.speechStartedAt - questionReceivedAt
          : null,
      ),
      secondSpeechDurationMs: roundPerformanceMs(
        secondSegment?.speechStartedAt !== null &&
          secondSegment?.speechStartedAt !== undefined &&
          secondSegment?.speechEndedAt !== null &&
          secondSegment?.speechEndedAt !== undefined
          ? secondSegment.speechEndedAt - secondSegment.speechStartedAt
          : null,
      ),
      segmentTimings: buildPerformanceSegmentTimings(performanceTurn),
      monitorVersion: PERFORMANCE_CONFIG.monitorVersion,
      benchmarkVersion: PERFORMANCE_CONFIG.benchmarkVersion,
      promptVersion: PERFORMANCE_CONFIG.promptVersion,
      knowledgeVersion: PERFORMANCE_CONFIG.knowledgeVersion,
      voiceVersion: PERFORMANCE_CONFIG.voiceVersion,
      avatarVersion: PERFORMANCE_CONFIG.avatarVersion,
      environment: getPerformanceEnvironment(),
      clientCompletedAt: new Date().toISOString(),
    };
  }

  function persistPerformanceTurn(payload: PerformanceTurnPayload) {
    void fetch("/api/performance/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          console.error("[Performance] Persistence failed", res.status, body);
          return;
        }

        console.log(
          `[Performance] Turn ${payload.turnNumber} persisted`,
          payload.eventId,
        );
      })
      .catch((error) => {
        console.error("[Performance] Persistence error", error);
      });
  }

  function createPerformanceSegment() {
    const performanceTurn = turnPerformanceRef.current;

    const segment: ResponseSegment = {
      segmentNumber: performanceTurn.segments.length + 1,
      responseText: "",
      responseEventAt: null,
      speechStartedAt: null,
      speechEndedAt: null,
    };

    performanceTurn.segments.push(segment);

    return segment;
  }

  function beginPerformanceTurn(questionText: string) {
    /*
     * The arrival of a new user question means the previous turn
     * has finished. Report it before beginning the new turn.
     */
    reportCompletedPerformanceTurn();

    const nextTurnNumber = turnPerformanceRef.current.turnNumber + 1;

    turnPerformanceRef.current = {
      eventId: crypto.randomUUID(),
      turnNumber: nextTurnNumber,
      questionText,
      questionReceivedAt: performance.now(),
      segments: [],
      reported: false,
    };

    console.log(
      `[Performance] Turn ${nextTurnNumber}: question received`,
      questionText,
    );
  }

  function recordAgentResponseSegment(responseText: string) {
    const performanceTurn = turnPerformanceRef.current;

    if (performanceTurn.questionReceivedAt === null) {
      /*
       * This may be the session greeting, which occurs before
       * the guest asks the first question.
       */
      return;
    }

    const cleanText = responseText.trim();

    if (!cleanText) {
      return;
    }

    const lastSegment =
      performanceTurn.segments[performanceTurn.segments.length - 1];

    /* Ignore an exact duplicate response event. */
    if (lastSegment && lastSegment.responseText === cleanText) {
      return;
    }

    /*
     * If speak_started arrived first, attach the response text
     * to that open segment. Otherwise create a new segment.
     */
    let segment = lastSegment;

    if (!segment || segment.responseEventAt !== null) {
      segment = createPerformanceSegment();
    }

    segment.responseText = cleanText;
    segment.responseEventAt = performance.now();

    const questionToResponse =
      segment.responseEventAt - performanceTurn.questionReceivedAt;

    console.log(
      `[Performance] Turn ${performanceTurn.turnNumber}, Segment ${
        segment.segmentNumber
      }: agent response event at ${Math.round(questionToResponse)}ms`,
      cleanText,
    );
  }

  function recordSpeechStartedSegment() {
    const performanceTurn = turnPerformanceRef.current;

    if (performanceTurn.questionReceivedAt === null) {
      /* Ignore session greeting speech before the first customer question. */
      return;
    }

    const lastSegment =
      performanceTurn.segments[performanceTurn.segments.length - 1];

    /* Ignore a duplicate speak_started event for the open segment. */
    if (
      lastSegment &&
      lastSegment.speechStartedAt !== null &&
      lastSegment.speechEndedAt === null
    ) {
      console.log(
        `[Performance] Duplicate speak_started ignored for Turn ${
          performanceTurn.turnNumber
        }, Segment ${lastSegment.segmentNumber}`,
      );

      return;
    }

    /*
     * If an agent-response event created the segment first,
     * attach speech timing to it. Otherwise create the segment.
     */
    let segment = lastSegment;

    if (!segment || segment.speechStartedAt !== null) {
      segment = createPerformanceSegment();
    }

    segment.speechStartedAt = performance.now();

    const questionToSpeech =
      segment.speechStartedAt - performanceTurn.questionReceivedAt;

    console.log(
      `[Performance] Turn ${performanceTurn.turnNumber}, Segment ${
        segment.segmentNumber
      }: speech started at ${Math.round(questionToSpeech)}ms`,
    );
  }

  function recordSpeechEndedSegment() {
    const performanceTurn = turnPerformanceRef.current;

    if (performanceTurn.questionReceivedAt === null) {
      return;
    }

    let openSegment: ResponseSegment | null = null;

    for (
      let index = performanceTurn.segments.length - 1;
      index >= 0;
      index -= 1
    ) {
      const candidate = performanceTurn.segments[index];

      if (
        candidate.speechStartedAt !== null &&
        candidate.speechEndedAt === null
      ) {
        openSegment = candidate;
        break;
      }
    }

    if (!openSegment) {
      console.log("[Performance] speak_ended received without an open segment");
      return;
    }

    openSegment.speechEndedAt = performance.now();
    reportPerformanceSegment(openSegment);
  }

  function reportPerformanceSegment(segment: ResponseSegment) {
    const performanceTurn = turnPerformanceRef.current;
    const questionReceivedAt = performanceTurn.questionReceivedAt;

    if (questionReceivedAt === null) {
      return;
    }

    const previousSegment = performanceTurn.segments[segment.segmentNumber - 2];

    const previousSegmentEnd = previousSegment?.speechEndedAt ?? null;

    const questionToResponse =
      segment.responseEventAt !== null
        ? segment.responseEventAt - questionReceivedAt
        : null;

    const questionToSpeech =
      segment.speechStartedAt !== null
        ? segment.speechStartedAt - questionReceivedAt
        : null;

    const speechDuration =
      segment.speechStartedAt !== null && segment.speechEndedAt !== null
        ? segment.speechEndedAt - segment.speechStartedAt
        : null;

    const gapFromPreviousSegment =
      previousSegmentEnd !== null && segment.speechStartedAt !== null
        ? segment.speechStartedAt - previousSegmentEnd
        : null;

    console.group(
      `[Performance] Turn ${performanceTurn.turnNumber}, Segment ${segment.segmentNumber}`,
    );

    console.table({
      "Question → response event": formatPerformanceMs(questionToResponse),
      "Question → speech start": formatPerformanceMs(questionToSpeech),
      "Response event timing": formatResponseEventTiming(
        segment.responseEventAt,
        segment.speechStartedAt,
      ),
      "Speech duration": formatPerformanceMs(speechDuration),
      "Previous segment end → this segment": formatPerformanceMs(
        gapFromPreviousSegment,
      ),
    });

    console.log(
      "Segment text:",
      segment.responseText || "(response text event not received yet)",
    );

    console.groupEnd();
  }

  function reportCompletedPerformanceTurn() {
    const performanceTurn = turnPerformanceRef.current;
    const questionReceivedAt = performanceTurn.questionReceivedAt;

    if (
      questionReceivedAt === null ||
      performanceTurn.reported ||
      performanceTurn.segments.length === 0
    ) {
      return;
    }

    const firstSegment = performanceTurn.segments[0];
    const secondSegment = performanceTurn.segments[1];

    const questionToFirstSegment =
      firstSegment?.speechStartedAt !== null &&
      firstSegment?.speechStartedAt !== undefined
        ? firstSegment.speechStartedAt - questionReceivedAt
        : null;

    const firstSegmentDuration =
      firstSegment?.speechStartedAt !== null &&
      firstSegment?.speechStartedAt !== undefined &&
      firstSegment?.speechEndedAt !== null &&
      firstSegment?.speechEndedAt !== undefined
        ? firstSegment.speechEndedAt - firstSegment.speechStartedAt
        : null;

    const firstToSecondGap =
      firstSegment?.speechEndedAt !== null &&
      firstSegment?.speechEndedAt !== undefined &&
      secondSegment?.speechStartedAt !== null &&
      secondSegment?.speechStartedAt !== undefined
        ? secondSegment.speechStartedAt - firstSegment.speechEndedAt
        : null;

    const questionToSecondSegment =
      secondSegment?.speechStartedAt !== null &&
      secondSegment?.speechStartedAt !== undefined
        ? secondSegment.speechStartedAt - questionReceivedAt
        : null;

    console.group(`[Performance] Turn ${performanceTurn.turnNumber} summary`);

    console.log("Question:", performanceTurn.questionText);

    console.table({
      "Segments observed": performanceTurn.segments.length,
      "Question → Segment 1 speech": formatPerformanceMs(
        questionToFirstSegment,
      ),
      "Segment 1 speech duration": formatPerformanceMs(firstSegmentDuration),
      "Segment 1 end → Segment 2 speech": formatPerformanceMs(firstToSecondGap),
      "Question → Segment 2 speech": formatPerformanceMs(
        questionToSecondSegment,
      ),
    });

    performanceTurn.segments.forEach((segment) => {
      console.log(
        `Segment ${segment.segmentNumber}:`,
        segment.responseText || "(text unavailable)",
      );
    });

    console.groupEnd();

    performanceTurn.reported = true;

    const payload = buildPerformanceTurnPayload(performanceTurn);

    if (payload) {
      persistPerformanceTurn(payload);
    }
  }

  function handleLiveKitData(payload: Uint8Array) {
    const raw = new TextDecoder().decode(payload);
    console.log("[Transcript event raw]", raw);

    try {
      const data = JSON.parse(raw);
      console.log("[Transcript event parsed]", data);

      const eventType = String(
        data.event_type ||
          data.elevenlabs_event_type ||
          data.type ||
          data.event ||
          data.name ||
          data.message_type ||
          data?.data?.event_type ||
          data?.data?.type ||
          "",
      ).toLowerCase();

      const role = String(
        data.role ||
          data.speaker ||
          data?.data?.role ||
          data?.data?.speaker ||
          "",
      ).toLowerCase();

      const candidateText =
        data.text ||
        data.transcript ||
        data.message ||
        data.response ||
        data.content ||
        data?.user_transcription_event?.user_transcript ||
        data?.agent_response_event?.agent_response ||
        data?.data?.text ||
        data?.data?.transcript ||
        data?.data?.message ||
        data?.data?.user_transcription_event?.user_transcript ||
        data?.data?.agent_response_event?.agent_response ||
        "";

      const text =
        typeof candidateText === "string" ? candidateText.trim() : "";

      if (eventType.includes("speak_started")) {
        recordSpeechStartedSegment();
        return;
      }

      if (eventType.includes("speak_ended")) {
        recordSpeechEndedSegment();
        return;
      }

      if (eventType.includes("chunk")) {
        return;
      }

      const hasUserTranscriptPayload = Boolean(
        data?.user_transcription_event || data?.data?.user_transcription_event,
      );

      const hasAgentResponsePayload = Boolean(
        data?.agent_response_event || data?.data?.agent_response_event,
      );

      const isUserTranscriptEvent =
        eventType === "user_transcript" ||
        eventType.includes("user_transcript") ||
        eventType.includes("user_transcription") ||
        (eventType.includes("user") &&
          (eventType.includes("transcript") ||
            eventType.includes("transcription"))) ||
        role === "user" ||
        hasUserTranscriptPayload;

      const isAgentResponseEvent =
        (eventType === "agent_response" ||
          eventType.includes("agent_response") ||
          (eventType.includes("avatar.transcription") && role !== "user") ||
          role === "assistant" ||
          role === "agent" ||
          hasAgentResponsePayload) &&
        !eventType.includes("correction") &&
        !eventType.includes("metadata") &&
        !eventType.includes("complete");

      if (isUserTranscriptEvent) {
        if (!text) {
          return;
        }

        if (shouldIgnoreDuplicateUserTranscript(text)) {
          console.log("[Performance] Duplicate user transcript ignored", {
            eventType,
            role,
            text,
          });

          return;
        }

        beginPerformanceTurn(text);
        addTranscriptEntry("User", text);
        return;
      }

      if (isAgentResponseEvent) {
        if (!text) {
          return;
        }

        recordAgentResponseSegment(text);
        addTranscriptEntry("Chef George", text);
        return;
      }

      if (text) {
        addTranscriptEntry("System", text);
      }
    } catch (error) {
      console.error("[Transcript Event Parse Error]", error, raw);

      if (raw.trim()) {
        addTranscriptEntry("System", raw);
      }
    }
  }

  useEffect(() => {
    async function loadCustomerAndWallet() {
      try {
        const params = new URLSearchParams(window.location.search);
        const emailFromUrl = params.get("email");

        if (emailFromUrl) {
          setCustomerEmail(emailFromUrl);
          await loadWalletBalance(emailFromUrl);
          return;
        }

        const meRes = await fetch("/api/customer/me");
        const me = await meRes.json();

        if (!me.authenticated) {
          window.location.href = "/";
          return;
        }

        setCustomerEmail(me.email);
        await loadWalletBalance(me.email);
      } catch (error) {
        console.error("[Customer Load Error]", error);
        window.location.href = "/";
      }
    }

    void loadCustomerAndWallet();
  }, []);

  useEffect(() => {
    function handleParentMessage(event: MessageEvent) {
      if (event.data?.type !== "CHEFIT_START_SESSION") {
        return;
      }

      console.log("[Chef-iT] Start session message received");

      if (isStarting || room || showMicCheck) {
        return;
      }

      setShowSessionComplete(false);
      void beginGatedMicCheck();
    }

    window.addEventListener("message", handleParentMessage);

    return () => {
      window.removeEventListener("message", handleParentMessage);
    };
  }, [isStarting, room, showMicCheck, customerEmail]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const interval = window.setInterval(async () => {
      const data = await spendOneSecond();

      if (!data) {
        window.clearInterval(interval);
        return;
      }

      const remaining = Number(data.remaining || 0);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        addTranscriptEntry(
          "System",
          "Session ended. Minute balance reached zero.",
        );
        window.clearInterval(interval);
        await stopAvatar();
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [room]);

  async function startAvatar() {
    if (isStarting || room) {
      return;
    }

    perfLog("startAvatar called");
    setShowSessionComplete(false);

    const sponsor = sponsors[Math.floor(Math.random() * sponsors.length)];

    setCurrentSponsor(sponsor);
    setShowSponsor(true);
    setIsStarting(true);
    setTranscript([]);
    transcriptRef.current = [];

    turnPerformanceRef.current = {
      eventId: "",
      turnNumber: 0,
      questionText: "",
      questionReceivedAt: null,
      segments: [],
      reported: false,
    };

    lastUserTranscriptRef.current = {
      normalizedText: "",
      receivedAt: 0,
    };

    setStatus(`This Chef-iT session is brought to you by ${sponsor.name}.`);

    perfLog("Starting Supabase session tracking");
    const trackingId = await startSessionTracking(sponsor.name);
    perfLog("Supabase session tracking complete");

    const startedAt = Date.now();

    if (trackingId) {
      trackedSessionIdRef.current = trackingId;
      sessionStartedAtRef.current = startedAt;
    }

    const uiStart = Date.now();

    try {
      perfLog("Requesting LiveAvatar session");

      const res = await fetch("/api/liveavatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerEmail }),
      });

      const data = await res.json();

      perfLog("LiveAvatar session response received");
      console.log("[Perf] Backend timing:", data.timing);

      if (!res.ok) {
        console.error(data);
        setStatus("Error creating session");
        setShowSponsor(false);
        await endSessionTracking();
        return;
      }

      setStatus("Connecting Chef George...");

      const newRoom = new Room();

      newRoom.on(RoomEvent.DataReceived, (payload) => {
        handleLiveKitData(payload);
      });

      newRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        const element = track.attach();

        console.log(
          `[Avatar UI] First ${track.kind} track received after ${
            Date.now() - uiStart
          }ms`,
        );

        perfLog(`First ${track.kind} track subscribed`);

        if (track.kind === "video") {
          const container = document.getElementById("avatar-video");

          if (container) {
            container.innerHTML = "";
            element.setAttribute(
              "style",
              "width:100%;height:100%;object-fit:cover;",
            );
            container.appendChild(element);
          }
        }

        if (track.kind === "audio") {
          element.setAttribute("autoplay", "true");
          document.body.appendChild(element);

          if (element instanceof HTMLMediaElement) {
            element.play().catch((error) => {
              console.warn("[Avatar UI] Audio autoplay blocked:", error);
            });
          }
        }
      });

      perfLog("Connecting to LiveKit");
      await newRoom.connect(data.livekit_url, data.livekit_client_token);
      perfLog("LiveKit connected");

      try {
        perfLog("Enabling LiveKit microphone");
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        perfLog("LiveKit microphone enabled");
      } catch (error) {
        console.error("[Avatar UI] Microphone permission denied:", error);
        setStatus("Please allow microphone access and try again.");
        newRoom.disconnect();
        setShowSponsor(false);
        await endSessionTracking();
        return;
      }

      setRoom(newRoom);
      setShowSponsor(false);
      setStatus("Connected. Speak to Chef George.");

      addTranscriptEntry(
        "System",
        `Session started. Sponsor: ${sponsor.name}.`,
      );
    } catch (error) {
      console.error("[Avatar UI] Start error:", error);
      setStatus("Could not start avatar. Please try again.");
      setShowSponsor(false);
      await endSessionTracking();
    } finally {
      setIsStarting(false);
    }
  }

  async function stopAvatar() {
    reportCompletedPerformanceTurn();

    room?.disconnect();
    setRoom(null);
    setShowSponsor(false);
    setStatus("Ready");
    setVideoKey((key) => key + 1);

    await endSessionTracking();
    await refreshWalletBeforeComplete();
  }

  function downloadTranscript() {
    const transcriptText = buildTranscriptText(transcript);
    const blob = new Blob([transcriptText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "chefit-transcript.txt";
    link.click();

    URL.revokeObjectURL(url);
  }

  async function emailTranscript() {
    const email = transcriptEmail.trim();

    if (!email) {
      return;
    }

    setIsEmailing(true);
    setEmailError("");
    setEmailSuccess(false);

    try {
      const res = await fetch("/api/email-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          transcript: buildTranscriptText(transcript),
        }),
      });

      if (!res.ok) {
        throw new Error("Email failed");
      }

      setEmailSuccess(true);

      window.setTimeout(() => {
        setShowEmailModal(false);
        setEmailSuccess(false);
      }, 1800);
    } catch (error) {
      console.error("[Email Transcript Error]", error);
      setEmailError(
        "We couldn't send your transcript right now. Please try again.",
      );
    } finally {
      setIsEmailing(false);
    }
  }

  async function loadWalletBalance(email: string) {
    try {
      const res = await fetch("/api/minutes/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok && data.seconds !== undefined) {
        setTimeRemaining(Number(data.seconds || 0));
      }
    } catch (error) {
      console.error("[Wallet Balance Load Error]", error);
    }
  }

  async function refreshWalletBeforeComplete() {
    if (customerEmail) {
      await loadWalletBalance(customerEmail);
    }

    setShowSessionComplete(true);
  }

  async function checkMinuteBalance() {
    try {
      const res = await fetch("/api/minutes/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: customerEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("[Minute Gate Error]", data);
        alert(
          "We could not check your Chef-iT minute balance. Please try again.",
        );
        return false;
      }

      if (!data.allowed) {
        alert(
          "You do not have any Chef-iT minutes remaining. Please purchase more minutes to continue.",
        );
        return false;
      }

      console.log("[Minute Gate] Time available:", data.display);

      const secondsAvailable = Number(data.seconds || 0);
      setTimeRemaining(secondsAvailable);

      return true;
    } catch (error) {
      console.error("[Minute Gate Error]", error);
      alert(
        "We could not check your Chef-iT minute balance. Please try again.",
      );
      return false;
    }
  }

  async function spendOneSecond() {
    try {
      const res = await fetch("/api/minutes/spend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: customerEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("[Minute Spend Error]", data);
        return false;
      }

      if (data.finished) {
        return { ...data, finished: true };
      }

      return data;
    } catch (error) {
      console.error("[Minute Spend Error]", error);
      return null;
    }
  }

  async function beginGatedMicCheck() {
    const allowed = await checkMinuteBalance();

    if (!allowed) {
      return;
    }

    await beginMicCheck();
  }

  const startDisabled = isStarting || Boolean(room);

  return (
    <main className="fixed inset-0 overflow-hidden bg-zinc-900 text-white">
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-zinc-900 [&_video]:object-cover [&_video]:object-center">
        <div className="absolute left-3 top-3 z-30 sm:left-5 sm:top-5">
          <Image
            src="/Chefit-White-New.png"
            alt="Chef-iT"
            width={110}
            height={40}
            priority
            className="h-auto w-auto max-w-[88px] sm:max-w-[110px]"
          />
        </div>

        <div className="absolute right-3 top-3 z-30 text-right sm:right-5 sm:top-5">
          <div
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-300 sm:px-4 sm:py-2 sm:text-sm ${timerColor}`}
          >
            {isStarting ? "Starting" : formattedTime}
          </div>

          {!room && !isStarting && (
            <p className="mt-1 text-[10px] text-zinc-300 sm:text-xs">
              Available time
            </p>
          )}
        </div>

        <div
          key={videoKey}
          id="avatar-video"
          className="absolute inset-0 flex items-center justify-center text-center"
        >
          {!room && !showSponsor && !showMicCheck && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Image
                src="/george-thumbnail.jpg"
                alt="Chef George"
                fill
                priority
                className="object-cover object-center opacity-80"
              />
              <div className="absolute inset-0 bg-black/30" />
              <div className="relative z-10 mx-auto max-w-sm px-6 sm:max-w-2xl">
                <p className="text-2xl font-bold text-white sm:text-3xl">
                  Meet Chef George
                </p>
                <p className="mt-3 text-sm text-zinc-200 sm:text-base">
                  Ask about live-fire cooking, recipes, menu costing, and
                  restaurant operations.
                </p>
              </div>
            </div>
          )}
        </div>

        {showMicCheck && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 px-5 text-center sm:px-8">
            <Image
              src="/Chefit-White-New.png"
              alt="Chef-iT"
              width={150}
              height={55}
              priority
              className="h-auto w-auto max-w-[125px] sm:max-w-[150px]"
            />

            <h2 className="mt-5 text-2xl font-bold sm:mt-6 sm:text-3xl">
              Microphone Check
            </h2>

            <p className="mt-3 max-w-sm text-sm text-zinc-300 sm:max-w-xl sm:text-base">
              Speak normally for a few seconds. When Chef-iT hears your
              microphone, the meter below will move.
            </p>

            <p className="mt-3 max-w-sm text-xs text-zinc-400 sm:max-w-xl sm:text-sm">
              Having trouble? Click Cancel, check your browser microphone
              permissions, then come back and try again.
            </p>

            <div className="mt-7 h-5 w-full max-w-sm overflow-hidden rounded-full bg-zinc-800 sm:mt-8 sm:max-w-md">
              <div
                className={`h-full transition-all ${
                  micReady ? "bg-green-500" : "bg-white"
                }`}
                style={{ width: `${micLevel}%` }}
              />
            </div>

            <p className="mt-4 max-w-sm text-sm text-zinc-300">
              {micError
                ? micError
                : micReady
                  ? "✓ Microphone detected. You're ready to talk with Chef George."
                  : "Listening for your microphone..."}
            </p>

            <div className="mt-7 flex w-full max-w-sm flex-col gap-3 sm:mt-8 sm:w-auto sm:max-w-none sm:flex-row sm:gap-4">
              <button
                onClick={cancelMicCheck}
                className="w-full rounded-full bg-zinc-700 px-6 py-3 font-semibold text-white sm:w-auto"
              >
                Cancel
              </button>

              <button
                onClick={continueAfterMicCheck}
                disabled={!micReady || Boolean(micError)}
                className={`w-full rounded-full px-6 py-3 font-semibold sm:w-auto ${
                  micReady && !micError
                    ? "bg-white text-black"
                    : "cursor-not-allowed bg-zinc-700 text-zinc-400"
                }`}
              >
                Continue to Chef George
              </button>
            </div>
          </div>
        )}

        {showSponsor && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 px-5 text-center sm:px-8">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 sm:text-sm sm:tracking-[0.25em]">
              This Chef-iT session is brought to you by
            </p>

            <div className="mt-5 max-w-[85%] rounded-2xl bg-white p-4 sm:mt-6 sm:p-6">
              <Image
                src={currentSponsor.logo}
                alt={currentSponsor.name}
                width={380}
                height={160}
                priority
                className="max-h-28 w-auto object-contain sm:max-h-40"
              />
            </div>

            <h2 className="mt-5 text-2xl font-bold sm:mt-6 sm:text-3xl">
              {currentSponsor.name}
            </h2>

            <p className="mt-5 text-base text-zinc-300 sm:mt-6 sm:text-lg">
              Preparing your Chef-iT session...
            </p>

            <p className="mt-2 text-sm text-zinc-500 sm:text-base">
              The On-Call Outdoor Chef is getting ready.
            </p>
          </div>
        )}

        {!showSponsor && !showMicCheck && (
          <div className="absolute bottom-4 left-0 right-0 z-30 flex justify-center px-4 sm:bottom-5">
            <div className="flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:gap-4">
              <button
                onClick={beginGatedMicCheck}
                disabled={startDisabled}
                className={`w-full rounded-full px-6 py-3 font-semibold sm:w-auto ${
                  startDisabled
                    ? "cursor-not-allowed bg-zinc-500 text-zinc-300"
                    : "bg-white text-black"
                }`}
              >
                {isStarting
                  ? "Starting..."
                  : room
                    ? "Session Running"
                    : "Start Session"}
              </button>

              <button
                onClick={stopAvatar}
                disabled={!room}
                className={`w-full rounded-full px-6 py-3 font-semibold sm:w-auto ${
                  room
                    ? "bg-red-600 text-white"
                    : "cursor-not-allowed bg-zinc-800 text-zinc-500"
                }`}
              >
                End Session
              </button>

              <button
                onClick={() => setShowTranscript(true)}
                className="w-full rounded-full bg-zinc-700 px-6 py-3 font-semibold text-white sm:w-auto"
              >
                Transcript
              </button>
            </div>
          </div>
        )}

        {showSessionComplete && !room && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 px-6 text-center">
            <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-black shadow-2xl">
              <h2 className="text-3xl font-bold">👨‍🍳 Session Complete</h2>

              <p className="mt-4 text-lg">
                Thanks for cooking with Chef George!
              </p>

              <div className="mt-6 rounded-xl bg-zinc-100 p-4">
                <p className="text-sm uppercase tracking-wide text-zinc-500">
                  Remaining Time
                </p>
                <p className="mt-2 text-3xl font-bold">{formattedTime}</p>
              </div>

              {timeRemaining > 0 ? (
                <>
                  <button
                    onClick={async () => {
                      setShowSessionComplete(false);
                      await beginGatedMicCheck();
                    }}
                    className="mt-6 w-full rounded-full bg-black px-6 py-3 font-semibold text-white transition hover:bg-zinc-800"
                  >
                    ▶ Start Another Session
                  </button>

                  <a
                    href="https://www.chasingtheflames.com/pages/chef-it"
                    target="_top"
                    className="mt-3 block w-full rounded-full bg-zinc-200 px-6 py-3 font-semibold text-black transition hover:bg-zinc-300"
                  >
                    Buy More Minutes
                  </a>
                </>
              ) : (
                <a
                  href="https://www.chasingtheflames.com/pages/chef-it"
                  target="_top"
                  className="mt-6 block w-full rounded-full bg-black px-6 py-3 font-semibold text-white transition hover:bg-zinc-800"
                >
                  Buy More Minutes
                </a>
              )}
            </div>
          </div>
        )}

        {showTranscript && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6">
            <div className="flex h-[92%] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 sm:max-h-[80%]">
              <div className="flex items-center justify-between border-b border-zinc-800 p-4 sm:p-5">
                <h2 className="text-lg font-bold sm:text-xl">
                  Session Transcript
                </h2>

                <button
                  onClick={() => setShowTranscript(false)}
                  className="text-zinc-400 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 text-left sm:p-5">
                {transcript.length === 0 ? (
                  <p className="text-zinc-400">
                    No transcript has been captured yet.
                  </p>
                ) : (
                  transcript.map((entry, index) => (
                    <div key={`${entry.timestamp}-${entry.speaker}-${index}`}>
                      <p className="text-xs text-zinc-500">{entry.timestamp}</p>
                      <p className="font-semibold">{entry.speaker}</p>
                      <p className="text-sm text-zinc-300 sm:text-base">
                        {entry.text}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-col justify-end gap-3 border-t border-zinc-800 p-4 sm:flex-row sm:p-5">
                <button
                  onClick={downloadTranscript}
                  disabled={transcript.length === 0}
                  className={`w-full rounded-full px-5 py-3 font-semibold sm:w-auto ${
                    transcript.length === 0
                      ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                      : "bg-white text-black"
                  }`}
                >
                  Download Transcript
                </button>

                <button
                  onClick={() => {
                    setTranscriptEmail(customerEmail || "");
                    setEmailSuccess(false);
                    setEmailError("");
                    setShowEmailModal(true);
                  }}
                  disabled={transcript.length === 0 || isEmailing}
                  className={`w-full rounded-full px-5 py-3 font-semibold sm:w-auto ${
                    transcript.length === 0 || isEmailing
                      ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                      : "bg-white text-black"
                  }`}
                >
                  Email Transcript
                </button>
              </div>
            </div>
          </div>
        )}

        {showEmailModal && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 text-left text-black shadow-2xl">
              <h2 className="text-2xl font-bold">Email Transcript</h2>

              <p className="mt-3 text-zinc-600">
                Send this Chef-iT session transcript to:
              </p>

              <input
                type="email"
                value={transcriptEmail}
                onChange={(event) => setTranscriptEmail(event.target.value)}
                className="mt-4 w-full rounded-xl border border-zinc-300 px-4 py-3 text-black"
                placeholder="email@example.com"
              />

              {emailError && (
                <p className="mt-3 text-sm text-red-600">{emailError}</p>
              )}

              {emailSuccess && (
                <p className="mt-3 text-sm font-semibold text-green-700">
                  ✓ Transcript sent successfully.
                </p>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setShowEmailModal(false)}
                  disabled={isEmailing}
                  className="rounded-full bg-zinc-200 px-5 py-3 font-semibold text-black"
                >
                  Cancel
                </button>

                <button
                  onClick={emailTranscript}
                  disabled={!transcriptEmail.trim() || isEmailing}
                  className={`rounded-full px-5 py-3 font-semibold ${
                    !transcriptEmail.trim() || isEmailing
                      ? "cursor-not-allowed bg-zinc-300 text-zinc-500"
                      : "bg-black text-white"
                  }`}
                >
                  {isEmailing ? "Sending..." : "Send Transcript"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
