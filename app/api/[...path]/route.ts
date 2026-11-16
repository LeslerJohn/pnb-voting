import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { hash, isHost, setHost, verifyPassword } from "@/lib/auth";
import { call, portraitKey, readPortrait, rehearsal, removePortrait, savePortrait, snapshot } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };
type Status = { status: string; receipt?: string; oldPhoto?: string };
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const photoLimit = 4 * 1024 * 1024;
const sharedCache = { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=4" };
const noStore = { "Cache-Control": "no-store" };

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: noStore });
}

function json(data: object, headers = noStore) {
  return NextResponse.json(data, { headers });
}

function unexpected(error: unknown) {
  console.error("Voting API failure", error);
  return fail("The voting service is temporarily unavailable. Try again.", 503);
}

export async function GET(request: NextRequest, context: Context) {
  const path = (await context.params).path.join("/");
  try {
    if (path === "ballot" || path === "stage") return json(await snapshot(path), sharedCache);
    if (path === "host/state") {
      if (!isHost(request)) return fail("Sign in to the host console.", 401);
      return json(await snapshot("host"));
    }
    if (rehearsal() && path.startsWith("photo/") && portraitKey.test(path.slice(6))) {
      const bytes = await readPortrait(path.slice(6)).catch(() => null);
      if (!bytes) return fail("Photo not found.", 404);
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
      });
    }
    return fail("Page not found.", 404);
  } catch (error) {
    return unexpected(error);
  }
}

async function cast(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.toUpperCase().replace(/[\s-]/g, "") : "";
  if (code.length !== 12 || [...code].some((character) => !alphabet.includes(character))) {
    return fail("Enter the 12-character attendee code from check-in.");
  }
  if (typeof body?.femaleId !== "string" || !uuid.test(body.femaleId) || typeof body?.maleId !== "string" || !uuid.test(body.maleId)) {
    return fail("Choose one nominee in each category.");
  }
  const result = await call<Status>("party_cast", { codeHash: hash(code), femaleId: body.femaleId, maleId: body.maleId });
  switch (result.status) {
    case "accepted": return json({ receipt: result.receipt });
    case "invalid": return fail("That code was not issued for this event. Check your card and try again.");
    case "used": return fail("A ballot has already been submitted with this code.", 409);
    case "closed": return fail("The poll is not currently accepting ballots.", 409);
    default: return fail("A nominee changed. Refresh the ballot and check your selections.", 409);
  }
}

function issueCode() {
  const raw = Array.from(randomBytes(12), (byte) => alphabet[byte & 31]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function issue(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const count = body?.count;
  if (!Number.isInteger(count) || count < 1 || count > 500) return fail("Generate between 1 and 500 codes at once.");
  const codes = new Set<string>();
  while (codes.size < count) codes.add(issueCode());
  const list = [...codes];
  const result = await call<Status>("party_issue", { hashes: list.map((code) => hash(code.replaceAll("-", ""))) });
  if (result.status !== "ok") return fail("Ticket issuance ended when voting closed.", 409);
  return json({ codes: list });
}

async function changePhase(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!["open", "closed", "revealed"].includes(body?.phase)) return fail("Unknown voting phase.");
  const state = await call<Status>("party_phase", { phase: body.phase });
  if (state.status === "nominees") return fail("Add at least one nominee to both categories first.", 409);
  if (state.status === "passes") return fail("Generate attendee codes before opening voting.", 409);
  if (state.status !== "ok") return fail("That phase change is unavailable.", 409);
  return json({ ok: true });
}

async function manageNominee(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return fail("The nominee form could not be read.");
  const id = form.get("id");
  if (id && (typeof id !== "string" || !uuid.test(id))) return fail("Invalid nominee.");
  const action = form.get("action") === "delete" ? "delete" : "save";
  const args: { action: string; id: string | null; name?: string; category?: string; photo?: string | null } = {
    action, id: typeof id === "string" && id ? id : null,
  };
  if (action === "delete" && !args.id) return fail("Choose a nominee to remove.");
  let uploaded: string | undefined;
  if (action === "save") {
    const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
    const category = form.get("category");
    if (!name || name.length > 100 || (category !== "female" && category !== "male")) return fail("Enter a valid name and category.");
    Object.assign(args, { name, category });
    const file = form.get("photo");
    if (file instanceof File && file.size) {
      if (file.size > photoLimit) return fail("Choose a photo under 4 MB.", 413);
      let image: Buffer;
      try {
        const source = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 36_000_000 });
        const metadata = await source.metadata();
        if (!metadata.format || !["jpeg", "png", "webp", "avif", "heif"].includes(metadata.format)) return fail("Upload a JPEG, PNG, WebP or AVIF photo.");
        image = await source.rotate().resize({ width: 640, height: 800, fit: "cover", position: "centre" })
          .webp({ quality: 79 }).toBuffer();
      } catch {
        return fail("This photo could not be read. Try a smaller JPEG, PNG, WebP or AVIF file.");
      }
      uploaded = `${randomUUID()}.webp`;
      await savePortrait(uploaded, image);
      args.photo = uploaded;
    } else if (form.get("removePhoto") === "on") {
      args.photo = null;
    }
  }

  // A transport error can follow a committed update, so keep the unique
  // uploaded file until the database confirms whether the mutation succeeded.
  const result = await call<Status>("party_nominee", args);
  if (result.status !== "ok") {
    if (uploaded) await removePortrait(uploaded);
    if (result.status === "missing") return fail("This nominee was already removed.", 404);
    if (result.status === "duplicate") return fail("A nominee with that name already exists in this category.", 409);
    if (result.status === "limit") return fail("The ballot supports up to 100 nominees.", 409);
    return fail("Nominees are locked once voting opens.", 409);
  }
  if (result.oldPhoto && portraitKey.test(result.oldPhoto)) await removePortrait(result.oldPhoto);
  return json({ ok: true });
}

export async function POST(request: NextRequest, context: Context) {
  const path = (await context.params).path.join("/");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const source = new URL(origin);
      if (source.host !== request.nextUrl.host && source.host !== request.headers.get("host")) return fail("Invalid request origin.", 403);
    } catch { return fail("Invalid request origin.", 403); }
  }
  const maxBody = path === "host/nominee" ? photoLimit + 65536 : 16_384;
  if (Number(request.headers.get("content-length")) > maxBody) return fail("The submission is too large.", 413);
  try {
    if (path === "cast") return await cast(request);
    if (path === "host/login") {
      const body = await request.json().catch(() => null);
      if (typeof body?.password !== "string" || !verifyPassword(body.password)) return fail("Incorrect host password.", 401);
      const response = json({ ok: true });
      setHost(request, response, true);
      return response;
    }
    if (!path.startsWith("host/")) return fail("Page not found.", 404);
    if (!isHost(request)) return fail("Sign in to the host console.", 401);
    if (path === "host/logout") {
      const response = json({ ok: true });
      setHost(request, response, false);
      return response;
    }
    if (path === "host/issue") return await issue(request);
    if (path === "host/phase") return await changePhase(request);
    if (path === "host/nominee") return await manageNominee(request);
    return fail("Page not found.", 404);
  } catch (error) {
    return unexpected(error);
  }
}
