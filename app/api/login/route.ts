import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, createSessionValue } from "../../../lib/auth";

export const runtime = "nodejs";

// Bloqueo por IP tras varios intentos fallidos. Vive en memoria de cada instancia,
// asi que es un freno extra; la defensa principal es una contraseña larga y aleatoria.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; until: number }>();

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const now = Date.now();
  const entry = fails.get(ip);
  if (entry && entry.until > now) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera 15 minutos." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password.slice(0, 256) : "";

  if (!password || !checkPassword(password)) {
    const count = (entry && entry.until > now - LOCK_MS ? entry.count : 0) + 1;
    fails.set(ip, { count, until: count >= MAX_FAILS ? now + LOCK_MS : 0 });
    if (fails.size > 10000) fails.clear();
    // Frenar intentos repetidos de adivinar la contraseña
    await new Promise((r) => setTimeout(r, 1000));
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }
  fails.delete(ip);

  const { value, maxAge } = createSessionValue();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
