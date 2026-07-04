"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Room, RoomEvent, RemoteTrack } from "livekit-client";

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

  const trackedSessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const perfStartRef = useRef<number>(0);

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
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
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
        if (level > 8) setMicReady(true);

        animationRef.current = requestAnimationFrame(animate);
      };

      animate();
    } catch (error) {
      console.error("[Mic Check Error]", error);
      setMicError(
        "We could not access your microphone. Please allow microphone access in your browser, then try again."
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

  function addTranscriptEntry(speaker: TranscriptEntry["speaker"], text: string) {
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

    if (!sessionId || !startedAt) return;

    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - startedAt) / 1000)
    );

    try {
      await fetch("/api/sessions/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    loadCustomerAndWallet();
  }, []);

   useEffect(() => {
     function handleParentMessage(event: MessageEvent) {
       if (event.data?.type !== "CHEFIT_START_SESSION") return;

     console.log("[Chef-iT] Start session message received");

     if (isStarting || room || showMicCheck) return;

    setShowSessionComplete(false);
    beginGatedMicCheck();
  }

  window.addEventListener("message", handleParentMessage);

  return () => {
    window.removeEventListener("message", handleParentMessage);
  };
}, [isStarting, room, showMicCheck, customerEmail]);
  useEffect(() => {
    if (!room) return;

    const interval = setInterval(async () => {
      const data = await spendOneSecond();

      if (!data) {
        clearInterval(interval);
        return;
      }

      const remaining = Number(data.remaining || 0);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        addTranscriptEntry("System", "Session ended. Minute balance reached zero.");
        clearInterval(interval);
        stopAvatar();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [room]);

  async function startAvatar() {
    if (isStarting || room) return;

    perfLog("startAvatar called");

    setShowSessionComplete(false);

    const sponsor = sponsors[Math.floor(Math.random() * sponsors.length)];
    setCurrentSponsor(sponsor);
    setShowSponsor(true);
    setIsStarting(true);
    setTranscript([]);
    transcriptRef.current = [];
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

        perfLog(`First ${track.kind} track subscribed`);

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

      addTranscriptEntry("System", `Session started. Sponsor: ${sponsor.name}.`);
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
    const email = prompt("Send transcript to which email?");
    if (!email) return;

    setIsEmailing(true);

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

      alert("Transcript emailed successfully!");
    } catch (error) {
      console.error("[Email Transcript Error]", error);
      alert("Could not send transcript.");
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
        alert("We could not check your Chef-iT minute balance. Please try again.");
        return false;
      }

      if (!data.allowed) {
        alert(
          "You do not have any Chef-iT minutes remaining. Please purchase more minutes to continue."
        );
        return false;
      }

      console.log("[Minute Gate] Time available:", data.display);

      const secondsAvailable = Number(data.seconds || 0);
      setTimeRemaining(secondsAvailable);

      return true;
    } catch (error) {
      console.error("[Minute Gate Error]", error);
      alert("We could not check your Chef-iT minute balance. Please try again.");
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
  } catch (err) {
    console.error("[Minute Spend Error]", err);
    return null;
  }
}

  async function beginGatedMicCheck() {
    const allowed = await checkMinuteBalance();
    if (!allowed) return;
    await beginMicCheck();
  }

const startDisabled = isStarting || !!room;

return (
  <main className="fixed inset-0 bg-zinc-900 text-white overflow-hidden">
  <div className="absolute inset-0 bg-zinc-900 overflow-hidden flex items-center justify-center [&_video]:object-cover [&_video]:object-center">
        <div className="absolute top-3 left-3 sm:top-5 sm:left-5 z-30">
          <Image
            src="/Chefit-White-New.png"
            alt="Chef-iT"
            width={110}
            height={40}
            priority
            className="h-auto w-auto max-w-[88px] sm:max-w-[110px]"
          />
        </div>

        <div className="absolute top-3 right-3 sm:top-5 sm:right-5 z-30 text-right">
          <div
            className={`rounded-full px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold transition-all duration-300 ${timerColor}`}
          >
            {isStarting ? "Starting" : formattedTime}
          </div>

          {!room && !isStarting && (
            <p className="mt-1 text-[10px] sm:text-xs text-zinc-300">
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
              <div className="relative z-10 px-6 max-w-sm sm:max-w-2xl mx-auto">
                <p className="text-2xl sm:text-3xl font-bold text-white">
                  Meet Chef George
                </p>
                <p className="mt-3 text-sm sm:text-base text-zinc-200">
                  Ask about live-fire cooking, recipes, menu costing, and restaurant operations.
                </p>
              </div>
            </div>
          )}
        </div>

        {showMicCheck && (
          <div className="absolute inset-0 z-40 bg-black/90 flex flex-col items-center justify-center text-center px-5 sm:px-8">
            <Image
              src="/Chefit-White-New.png"
              alt="Chef-iT"
              width={150}
              height={55}
              priority
              className="h-auto w-auto max-w-[125px] sm:max-w-[150px]"
            />

            <h2 className="mt-5 sm:mt-6 text-2xl sm:text-3xl font-bold">
              Microphone Check
            </h2>

            <p className="mt-3 max-w-sm sm:max-w-xl text-sm sm:text-base text-zinc-300">
              Speak normally for a few seconds. When Chef-iT hears your microphone,
              the meter below will move.
            </p>

<p className="mt-3 max-w-sm sm:max-w-xl text-xs sm:text-sm text-zinc-400">
  Having trouble? Click Cancel, check your browser microphone permissions, then come back and try again.
</p>

            <div className="mt-7 sm:mt-8 w-full max-w-sm sm:max-w-md rounded-full bg-zinc-800 overflow-hidden h-5">
              <div
                className={`h-full transition-all ${
                  micReady ? "bg-green-500" : "bg-white"
                }`}
                style={{ width: `${micLevel}%` }}
              />
            </div>

            <p className="mt-4 text-sm max-w-sm text-zinc-300">
              {micError
                ? micError
                : micReady
                ? "✓ Microphone detected. You're ready to talk with Chef George."
                : "Listening for your microphone..."}
            </p>

            <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-sm sm:max-w-none sm:w-auto">
              <button
                onClick={cancelMicCheck}
                className="w-full sm:w-auto px-6 py-3 rounded-full font-semibold bg-zinc-700 text-white"
              >
                Cancel
              </button>

              <button
                onClick={continueAfterMicCheck}
                disabled={!micReady || !!micError}
                className={`w-full sm:w-auto px-6 py-3 rounded-full font-semibold ${
                  micReady && !micError
                    ? "bg-white text-black"
                    : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                }`}
              >
                Continue to Chef George
              </button>
            </div>
          </div>
        )}

        {showSponsor && (
          <div className="absolute inset-0 z-20 bg-black/90 flex flex-col items-center justify-center text-center px-5 sm:px-8">
            <p className="text-[10px] sm:text-sm uppercase tracking-[0.18em] sm:tracking-[0.25em] text-zinc-400">
              This Chef-iT session is brought to you by
            </p>

            <div className="mt-5 sm:mt-6 rounded-2xl bg-white p-4 sm:p-6 max-w-[85%]">
              <Image
                src={currentSponsor.logo}
                alt={currentSponsor.name}
                width={380}
                height={160}
                priority
                className="max-h-28 sm:max-h-40 w-auto object-contain"
              />
            </div>

            <h2 className="mt-5 sm:mt-6 text-2xl sm:text-3xl font-bold">
              {currentSponsor.name}
            </h2>

            <p className="mt-5 sm:mt-6 text-base sm:text-lg text-zinc-300">
              Preparing your Chef-iT session...
            </p>

            <p className="mt-2 text-sm sm:text-base text-zinc-500">
              The On-Call Outdoor Chef is getting ready.
            </p>
          </div>
        )}

        {!showSponsor && !showMicCheck && (
          <div className="absolute bottom-4 sm:bottom-5 left-0 right-0 z-30 flex justify-center px-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-sm sm:max-w-none sm:w-auto">
              <button
                onClick={beginGatedMicCheck}
                disabled={startDisabled}
                className={`w-full sm:w-auto px-6 py-3 rounded-full font-semibold ${
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
                className={`w-full sm:w-auto px-6 py-3 rounded-full font-semibold ${
                  room
                    ? "bg-red-600 text-white"
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                }`}
              >
                End Session
              </button>

              <button
                onClick={() => setShowTranscript(true)}
                className="w-full sm:w-auto px-6 py-3 rounded-full font-semibold bg-zinc-700 text-white"
              >
                Transcript
              </button>
            </div>
          </div>
        )}

{showSessionComplete && !room && (
  <div className="absolute inset-0 z-50 bg-black/85 flex items-center justify-center text-center px-6">
    <div className="bg-white text-black rounded-2xl p-8 max-w-sm w-full shadow-2xl">

      <h2 className="text-3xl font-bold">👨‍🍳 Session Complete</h2>

      <p className="mt-4 text-lg">
        Thanks for cooking with Chef George!
      </p>

      <div className="mt-6 rounded-xl bg-zinc-100 p-4">
        <p className="text-sm uppercase tracking-wide text-zinc-500">
          Remaining Time
        </p>
        <p className="mt-2 text-3xl font-bold">
          {formattedTime}
        </p>
      </div>

      {timeRemaining > 0 ? (
        <>
          <button
            onClick={async () => {
              setShowSessionComplete(false);
              await beginGatedMicCheck();
            }}
            className="mt-6 w-full px-6 py-3 rounded-full font-semibold bg-black text-white hover:bg-zinc-800 transition"
          >
            ▶ Start Another Session
          </button>

          <a
            href="https://www.chasingtheflames.com/pages/chef-it"
            target="_top"
            className="mt-3 block w-full px-6 py-3 rounded-full font-semibold bg-zinc-200 text-black hover:bg-zinc-300 transition"
          >
            Buy More Minutes
          </a>
        </>
      ) : (
        <a
          href="https://www.chasingtheflames.com/pages/chef-it"
          target="_top"
          className="mt-6 block w-full px-6 py-3 rounded-full font-semibold bg-black text-white hover:bg-zinc-800 transition"
        >
          Buy More Minutes
        </a>
      )}

    </div>
  </div>
)}

        {showTranscript && (
          <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6">
            <div className="bg-zinc-950 border border-zinc-700 rounded-2xl w-full max-w-3xl h-[92%] sm:max-h-[80%] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-zinc-800">
                <h2 className="text-lg sm:text-xl font-bold">
                  Session Transcript
                </h2>

                <button
                  onClick={() => setShowTranscript(false)}
                  className="text-zinc-400 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto text-left space-y-4">
                {transcript.length === 0 ? (
                  <p className="text-zinc-400">
                    No transcript has been captured yet.
                  </p>
                ) : (
                  transcript.map((entry, index) => (
                    <div key={index}>
                      <p className="text-xs text-zinc-500">{entry.timestamp}</p>
                      <p className="font-semibold">{entry.speaker}</p>
                      <p className="text-sm sm:text-base text-zinc-300">
                        {entry.text}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 sm:p-5 border-t border-zinc-800 flex flex-col sm:flex-row justify-end gap-3">
                <button
                  onClick={downloadTranscript}
                  disabled={transcript.length === 0}
                  className={`w-full sm:w-auto px-5 py-3 rounded-full font-semibold ${
                    transcript.length === 0
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-white text-black"
                  }`}
                >
                  Download Transcript
                </button>

                <button
  disabled
  className="w-full sm:w-auto px-5 py-3 rounded-full font-semibold bg-zinc-800 text-zinc-500 cursor-not-allowed"
>
  Email Coming Soon
</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}