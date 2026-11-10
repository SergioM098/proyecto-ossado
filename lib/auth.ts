import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ossado_session";
const SESSION_HOURS = 12;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  // Comparar hashes de igual longitud para no filtrar la longitud ni el contenido por tiempos
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("Falta la variable de entorno APP_PASSWORD");
  return safeEqual(password, expected);
}

export function createSessionValue(): { value: string; maxAge: number } {
  const maxAge = SESSION_HOURS * 60 * 60;
  const exp = String(Date.now() + maxAge * 1000);
  return { value: `${exp}.${sign(exp)}`, maxAge };
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) return false;

  const [exp, signature] = value.split(".");
  if (!exp || !signature || !safeEqual(signature, sign(exp))) return false;
  return Number(exp) > Date.now();
}
