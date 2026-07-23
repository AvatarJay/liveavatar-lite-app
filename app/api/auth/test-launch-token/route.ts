import { NextResponse } from "next/server";
import { verifyLaunchToken } from "@/lib/auth/launch-token";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing launch token.",
      },
      { status: 401 }
    );
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing launch token.",
      },
      { status: 401 }
    );
  }

  try {
    const identity = await verifyLaunchToken(token);

    return NextResponse.json({
      success: true,
      message: "Launch token verified.",
      identity,
    });
  } catch (error) {
    console.error("Launch token verification failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Invalid or expired launch token.",
      },
      { status: 401 }
    );
  }
}