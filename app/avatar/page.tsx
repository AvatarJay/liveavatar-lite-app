"use client";

import { useState } from "react";
import { Room, RoomEvent, RemoteTrack } from "livekit-client";

export default function AvatarPage() {
  const [status, setStatus] = useState("Ready");
  const [room, setRoom] = useState<Room | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  async function startAvatar() {
    if (isStarting || room) return;

    setIsStarting(true);
    setStatus("Warming up Chef George...");

    const uiStart = Date.now();
    console.log("[Avatar UI] Start clicked");

    try {
      const res = await fetch("/api/liveavatar/session", { method: "POST" });
      const data = await res.json();

      console.log("[Avatar UI] Backend returned:", data.timing);

      if (!res.ok) {
        console.error(data);
        setStatus("Error creating session");
        return;
      }

      setStatus("Connecting voice and avatar stream...");

      const newRoom = new Room();

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
          document.body.appendChild(element);
        }
      });

      const connectStart = Date.now();
      console.log("[Avatar UI] Connecting to LiveKit...");

      await newRoom.connect(data.livekit_url, data.livekit_client_token);

      console.log(
        `[Avatar UI] LiveKit connected in ${Date.now() - connectStart}ms`
      );
      console.log(
        `[Avatar UI] Total time to connected: ${Date.now() - uiStart}ms`
      );

      setStatus("Enabling microphone...");
      await newRoom.localParticipant.setMicrophoneEnabled(true);

      setRoom(newRoom);
      setStatus("Connected. Speak to Chef George.");
    } catch (error) {
      console.error("[Avatar UI] Start error:", error);
      setStatus("Could not start avatar. Please try again.");
    } finally {
      setIsStarting(false);
    }
  }

  function stopAvatar() {
    room?.disconnect();
    setRoom(null);
    setStatus("Disconnected");
  }

  const startDisabled = isStarting || !!room;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">LiveAvatar Lite Coach</h1>

      <div
        id="avatar-video"
        className="w-full max-w-4xl aspect-video bg-zinc-900 rounded-xl overflow-hidden flex items-center justify-center"
      >
        <p className="text-zinc-400">Avatar video will appear here</p>
      </div>

      <p>{status}</p>

      <div className="flex gap-4">
        <button
          onClick={startAvatar}
          disabled={startDisabled}
          className={`px-5 py-3 rounded-lg font-semibold ${
            startDisabled
              ? "bg-zinc-500 text-zinc-300 cursor-not-allowed"
              : "bg-white text-black"
          }`}
        >
          {isStarting ? "Starting..." : room ? "Avatar Running" : "Start Avatar"}
        </button>

        <button
          onClick={stopAvatar}
          disabled={!room}
          className={`px-5 py-3 rounded-lg font-semibold ${
            room
              ? "bg-zinc-700 text-white"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          }`}
        >
          Stop
        </button>
      </div>
    </main>
  );
}