"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Room, RoomEvent, RemoteTrack } from "livekit-client";

const SESSION_SECONDS = 20 * 60;

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

export default function AvatarPage() {
  const [status, setStatus] = useState("Ready");
  const [room, setRoom] = useState<Room | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showSponsor, setShowSponsor] = useState(false);
  const [currentSponsor, setCurrentSponsor] = useState(sponsors[0]);
  const [videoKey, setVideoKey] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(SESSION_SECONDS);
  const [warnedFive, setWarnedFive] = useState(false);
  const [warnedOne, setWarnedOne] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [trackedSessionId, setTrackedSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

  const trackedSessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const timerColor =
    timeRemaining <= 60
      ? "bg-red-600 text-white"
      : timeRemaining <= 5 * 60
      ? "bg-yellow-400 text-black"
      : "bg-black/65 text-white";

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  function addTranscriptEntry(
    speaker: TranscriptEntry["speaker"],
    text: string
  ) {
    if (!text || !text.trim()) return;

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
        (entry) => `[${entry.timestamp}] ${entry.speaker}: ${entry.text}`
      ),
    ].join("\n");
  }

  async function startSessionTracking(sponsorName: string) {
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sponsorName }),
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

    if (!sessionId || !startedAt) return;

    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - startedAt) / 1000)
    );

    try {
      await fetch("/api/sessions/end", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          durationSeconds,
          transcript: buildTranscriptText(transcriptRef.current),
        }),
      });
    } catch (error) {
      console.error("[Session Tracking End Error]", error);
    }

    trackedSessionIdRef.current = null;
    sessionStartedAtRef.current = null;
    setTrackedSessionId(null);
    setSessionStartedAt(null);
  }

  function handleLiveKitData(payload: Uint8Array) {
    const raw = new TextDecoder().decode(payload);

    console.log("[Transcript event raw]", raw);

    try {
      const data = JSON.parse(raw);
      console.log("[Transcript event parsed]", data);

      const eventType =
        data.event_type ||
        data.elevenlabs_event_type ||
        data.type ||
        data.event ||
        data.name ||
        data.message_type ||
        "";

      if (
        eventType.includes("chunk") ||
        eventType.includes("speak_started") ||
        eventType.includes("speak_ended")
      ) {
        return;
      }

      const text =
        data.text ||
        data.transcript ||
        data.message ||
        data.response ||
        data.content ||
        data?.data?.text ||
        data?.data?.transcript ||
        data?.data?.message ||
        data?.data?.user_transcription_event?.user_transcript ||
        data?.data?.agent_response_event?.agent_response ||
        "";

      if (!text) return;

      if (
        eventType.includes("user") ||
        data.role === "user" ||
        data?.data?.user_transcription_event
      ) {
        addTranscriptEntry("User", text);
        return;
      }

      if (
        eventType.includes("agent") ||
        eventType.includes("response") ||
        eventType.includes("avatar.transcription") ||
        data.role === "assistant" ||
        data?.data?.agent_response_event
      ) {
        addTranscriptEntry("Chef George", text);
        return;
      }

      addTranscriptEntry("System", text);
    } catch {
      if (raw.trim()) {
        addTranscriptEntry("System", raw);
      }
    }
  }

  function speakNotice(message: string) {
    if (typeof window === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    if (!room) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          addTranscriptEntry("System", "Session ended. Time limit reached.");
          stopAvatar();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [room]);

  useEffect(() => {
    if (!room) return;

    if (timeRemaining === 5 * 60 && !warnedFive) {
      setWarnedFive(true);
      speakNotice("You have five minutes remaining in this Chef-it session.");
    }

    if (timeRemaining === 60 && !warnedOne) {
      setWarnedOne(true);
      speakNotice("You have one minute remaining in this Chef-it session.");
    }
  }, [timeRemaining, room, warnedFive, warnedOne]);

  async function startAvatar() {
    if (isStarting || room) return;

    const sponsor = sponsors[Math.floor(Math.random() * sponsors.length)];

    setCurrentSponsor(sponsor);
    setShowSponsor(true);
    setIsStarting(true);
    setTranscript([]);
    transcriptRef.current = [];
    setTimeRemaining(SESSION_SECONDS);
    setWarnedFive(false);
    setWarnedOne(false);
    setStatus(`This Chef-it session is brought to you by ${sponsor.name}.`);

    const trackingId = await startSessionTracking(sponsor.name);
    const startedAt = Date.now();

    if (trackingId) {
      trackedSessionIdRef.current = trackingId;
      sessionStartedAtRef.current = startedAt;
      setTrackedSessionId(trackingId);
      setSessionStartedAt(startedAt);
    }

    const uiStart = Date.now();

    try {
      const res = await fetch("/api/liveavatar/session", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        console.error(data);
        setStatus("Error creating session");
        setShowSponsor(false);
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
          }ms`
        );

        if (track.kind === "video") {
          const container = document.getElementById("avatar-video");
          if (container) {
            container.innerHTML = "";
            element.setAttribute(
              "style",
              "width:100%;height:100%;object-fit:cover;"
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

      await newRoom.connect(data.livekit_url, data.livekit_client_token);

      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true);
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
        `Session started. Sponsor: ${sponsor.name}.`
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
    room?.disconnect();
    setRoom(null);
    setShowSponsor(false);
    setStatus("Ready");
    setVideoKey((key) => key + 1);
    await endSessionTracking();
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

  const startDisabled = isStarting || !!room;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-5xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-6">
          Welcome to Chef-it
        </h1>

        <div className="relative w-full aspect-video bg-zinc-900 rounded-2xl overflow-hidden flex items-center justify-center">
          <div className="absolute top-5 left-5 z-30">
            <Image
              src="/Chefit-White.png"
              alt="Chef-it"
              width={120}
              height={45}
              priority
            />
          </div>

          <div
            className={`absolute top-5 right-5 z-30 rounded-full px-4 py-2 text-sm font-semibold ${timerColor}`}
          >
            {room ? formattedTime : isStarting ? "Starting" : "Ready"}
          </div>

          <div
            key={videoKey}
            id="avatar-video"
            className="absolute inset-0 flex items-center justify-center text-center"
          >
            {!room && !showSponsor && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Image
                  src="/george-thumbnail.jpg"
                  alt="Chef George"
                  fill
                  priority
                  className="object-cover opacity-70"
                />

                <div className="absolute inset-0 bg-black/35" />

                <div className="relative z-10 px-6 max-w-2xl mx-auto">
                  <p className="text-3xl font-bold text-white">
                    Meet Chef George
                  </p>
                  <p className="mt-3 text-zinc-200">
                    Ask about live-fire cooking, recipes, menu costing, and restaurant operations.
                  </p>
                </div>
              </div>
            )}
          </div>

          {showSponsor && (
            <div className="absolute inset-0 z-20 bg-black/90 flex flex-col items-center justify-center text-center px-8">
              <p className="text-sm uppercase tracking-[0.25em] text-zinc-400">
                This Chef-it session is brought to you by
              </p>

              <div className="mt-6 rounded-2xl bg-white p-6">
                <Image
                  src={currentSponsor.logo}
                  alt={currentSponsor.name}
                  width={380}
                  height={160}
                  priority
                  className="max-h-40 w-auto object-contain"
                />
              </div>

              <h2 className="mt-6 text-3xl font-bold">
                {currentSponsor.name}
              </h2>

              <p className="mt-6 text-lg text-zinc-300">
                Preparing your Chef-it session...
              </p>

              <p className="mt-2 text-zinc-500">
                The On-Call Outdoor Chef is getting ready.
              </p>
            </div>
          )}

          {!showSponsor && (
            <div className="absolute bottom-5 left-0 right-0 z-30 flex justify-center">
              <div className="flex gap-4">
                <button
                  onClick={startAvatar}
                  disabled={startDisabled}
                  className={`px-6 py-3 rounded-full font-semibold ${
                    startDisabled
                      ? "bg-zinc-500 text-zinc-300 cursor-not-allowed"
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
                  className={`px-6 py-3 rounded-full font-semibold ${
                    room
                      ? "bg-red-600 text-white"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  }`}
                >
                  End Session
                </button>

                <button
                  onClick={() => setShowTranscript(true)}
                  className="px-6 py-3 rounded-full font-semibold bg-zinc-700 text-white"
                >
                  Transcript
                </button>
              </div>
            </div>
          )}

          {showTranscript && (
            <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
              <div className="bg-zinc-950 border border-zinc-700 rounded-2xl w-full max-w-3xl max-h-[80%] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-zinc-800">
                  <h2 className="text-xl font-bold">Session Transcript</h2>
                  <button
                    onClick={() => setShowTranscript(false)}
                    className="text-zinc-400 hover:text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="p-5 overflow-y-auto text-left space-y-4">
                  {transcript.length === 0 ? (
                    <p className="text-zinc-400">
                      No transcript has been captured yet.
                    </p>
                  ) : (
                    transcript.map((entry, index) => (
                      <div key={index}>
                        <p className="text-xs text-zinc-500">
                          {entry.timestamp}
                        </p>
                        <p className="font-semibold">{entry.speaker}</p>
                        <p className="text-zinc-300">{entry.text}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-5 border-t border-zinc-800 flex justify-end gap-3">
                  <button
                    onClick={downloadTranscript}
                    disabled={transcript.length === 0}
                    className={`px-5 py-3 rounded-full font-semibold ${
                      transcript.length === 0
                        ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                        : "bg-white text-black"
                    }`}
                  >
                    Download Transcript
                  </button>

                  <button className="px-5 py-3 rounded-full font-semibold bg-zinc-800 text-zinc-500 cursor-not-allowed">
                    Email Coming Soon
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}