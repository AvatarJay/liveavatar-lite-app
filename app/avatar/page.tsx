"use client";

import { useState } from "react";
import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from "livekit-client";

export default function AvatarPage() {
  const [status, setStatus] = useState("Ready");
  const [room, setRoom] = useState<Room | null>(null);

  async function startAvatar() {
    setStatus("Creating LiveAvatar Lite session...");

    const res = await fetch("/api/liveavatar/session", { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      console.error(data);
      setStatus("Error creating session");
      return;
    }

    const newRoom = new Room();

    newRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      const element = track.attach();

      if (track.kind === "video") {
        const container = document.getElementById("avatar-video");
        if (container) {
          container.innerHTML = "";
          element.setAttribute("style", "width:100%;height:100%;object-fit:cover;");
          container.appendChild(element);
        }
      }

      if (track.kind === "audio") {
        document.body.appendChild(element);
      }
    });

    await newRoom.connect(data.livekit_url, data.livekit_client_token);
    await newRoom.localParticipant.setMicrophoneEnabled(true);

    setRoom(newRoom);
    setStatus("Connected. Speak to the avatar.");
  }

  function stopAvatar() {
    room?.disconnect();
    setRoom(null);
    setStatus("Disconnected");
  }

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
        <button onClick={startAvatar} className="bg-white text-black px-5 py-3 rounded-lg font-semibold">
          Start Avatar
        </button>

        <button onClick={stopAvatar} className="bg-zinc-700 px-5 py-3 rounded-lg font-semibold">
          Stop
        </button>
      </div>
    </main>
  );
}