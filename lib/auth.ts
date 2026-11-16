import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type NextRequest, type NextResponse } from "next/server";
import { rehearsal } from "@/lib/database";

const cookieName = "pnb_host";
const seconds = 8 * 60 * 60;

function password() {
  const value = process.env.ADMIN_PASSWORD;
  if (value && value.length >= 16) return value;
  if (rehearsal() && process.env.NODE_ENV === "development" && !value) return "pnb-rehearsal-only";
  throw new Error("Set ADMIN_PASSWORD to a unique password of at least 16 characters.");
}

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function matches(first: string, second: string) {
  return timingSafeEqual(Buffer.from(hash(first), "hex"), Buffer.from(hash(second), "hex"));
}

function signature(expires: string) {
  return createHmac("sha256", password()).update(`pnb-voting-host.${expires}`).digest("hex");
}

export function verifyPassword(value: string) {
  return matches(value, password());
}

export function isHost(request: NextRequest) {
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return false;
  const [expires, signed, extra] = token.split(".");
  return !extra && !!signed && /^\d{10}$/.test(expires) &&
    Number(expires) > Math.floor(Date.now() / 1000) && matches(signed, signature(expires));
}

export function setHost(request: NextRequest, response: NextResponse, active: boolean) {
  const expires = String(Math.floor(Date.now() / 1000) + seconds);
  response.cookies.set(cookieName, active ? `${expires}.${signature(expires)}` : "", {
    maxAge: active ? seconds : 0,
    httpOnly: true,
    sameSite: "strict",
    secure: !rehearsal() || request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/api/host",
  });
}
