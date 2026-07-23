import { NextResponse } from "next/server";
import { verifyLaunchToken } from "@/lib/auth/launch-token";

export type LaunchIdentity = {
  shop: string;
  customerId: string;
  issuedAt?: number;
  expiresAt?: number;
};

type LaunchAuthenticationResult =
  | {
      success: true;
      identity: LaunchIdentity;
    }
  | {
      success: false;
      response: NextResponse;
    };

export async function requireLaunchToken(
  request: Request
): Promise<LaunchAuthenticationResult> {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Missing launch token.",
        },
        { status: 401 }
      ),
    };
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Missing launch token.",
        },
        { status: 401 }
      ),
    };
  }

  try {
    const identity = await verifyLaunchToken(token);

    return {
      success: true,
      identity,
    };
  } catch (error) {
    console.error("Launch token verification failed:", error);

    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Invalid or expired launch token.",
        },
        { status: 401 }
      ),
    };
  }
}