import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, createSessionValue } from "../../../lib/auth";

export const runtime = "nodejs";

// Retardo progresivo por IP: cada fallo tarda mas en responder, asi probar
// claves se vuelve cada vez mas lento. El conteo vive en la memoria de cada
// instancia de Vercel, asi que es "lo mejor posible" (escala cuando los intentos
// caen en la misma instancia; en el peor caso se queda en BASE_MS). La defensa
// principal sigue siendo una contraseña larga y aleatoria.
const BASE_MS = 1000;
const MAX_MS = 10000;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; seen: number }>();

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const now = Date.now();
  const entry = fails.get(ip);

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password.slice(0, 256) : "";

  if (!password || !checkPassword(password)) {
    const count = (entry && now - entry.seen < WINDOW_MS ? entry.count : 0) + 1;
    fails.set(ip, { count, seen: now });
    if (fails.size > 10000) fails.clear();
    // Retardo que crece con cada fallo: 1s, 2s, 4s, 8s... hasta 10s
    const delay = Math.min(BASE_MS * 2 ** (count - 1), MAX_MS);
    await new Promise((r) => setTimeout(r, delay));
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
