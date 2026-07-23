import { NextResponse } from "next/server";
import { requireLaunchToken } from "@/lib/auth/require-launch-token";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authentication = await requireLaunchToken(request);

  if (!authentication.success) {
    return authentication.response;
  }

  return NextResponse.json({
    success: true,
    message: "Launch token verified through reusable authentication helper.",
    identity: authentication.identity,
  });
}