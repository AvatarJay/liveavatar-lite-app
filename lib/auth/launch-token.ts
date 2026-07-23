import { SignJWT } from "jose";

const secret = new TextEncoder().encode(
  process.env.CHEFIT_LAUNCH_TOKEN_SECRET
);

export async function createLaunchToken(payload: {
  shop: string;
  customerId: string;
}) {
  return await new SignJWT({
    shop: payload.shop,
    customerId: payload.customerId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(secret);
}