import { SignJWT, jwtVerify } from "jose";

function getLaunchTokenSecret() {
  const value = process.env.CHEFIT_LAUNCH_TOKEN_SECRET;

  if (!value) {
    throw new Error("CHEFIT_LAUNCH_TOKEN_SECRET is not configured.");
  }

  return new TextEncoder().encode(value);
}

export async function createLaunchToken(payload: {
  shop: string;
  customerId: string;
}) {
  return new SignJWT({
    shop: payload.shop,
    customerId: payload.customerId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getLaunchTokenSecret());
}

export async function verifyLaunchToken(token: string) {
  const { payload } = await jwtVerify(
    token,
    getLaunchTokenSecret(),
    {
      algorithms: ["HS256"],
    }
  );

  const shop = payload.shop;
  const customerId = payload.customerId;

  if (
    typeof shop !== "string" ||
    typeof customerId !== "string"
  ) {
    throw new Error("Invalid launch token payload.");
  }

  return {
    shop,
    customerId,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}