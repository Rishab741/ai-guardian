/**
 * Console session handling.
 *
 * Demo personas: the gateway issues a short-lived token, kept in
 * sessionStorage so a page refresh doesn't sign the presenter out (closing
 * the tab does).
 * Firebase: the Firebase SDK owns the session and refreshes ID tokens itself;
 * we ask it for a fresh one per request. The SDK is loaded only when the
 * gateway reports a Firebase config, so persona-only deployments don't ship it.
 */
import type { AuthConfig } from "./types";

const KEY = "sf.session";
type Stored = { source: "demo"; token: string } | { source: "firebase" };

function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function write(s: Stored | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): the session lasts for this page only.
  }
  memory = s;
}

let memory: Stored | null = null;

export function hasSession(): boolean {
  return (memory ?? read()) !== null;
}

export function setDemoSession(token: string) {
  write({ source: "demo", token });
}

let firebaseConfig: AuthConfig["firebase"] = null;

async function firebaseAuth() {
  if (!firebaseConfig) return null;
  const { initializeApp, getApps } = await import("firebase/app");
  const { getAuth } = await import("firebase/auth");
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  return getAuth(app);
}

export function setFirebaseConfig(cfg: AuthConfig["firebase"]) {
  firebaseConfig = cfg;
}

export async function signInWithGoogle(): Promise<void> {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("Google sign-in isn't configured on this deployment.");
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  await signInWithPopup(auth, new GoogleAuthProvider());
  write({ source: "firebase" });
}

export async function bearer(): Promise<string | null> {
  const s = memory ?? read();
  if (!s) return null;
  if (s.source === "demo") return s.token;
  const auth = await firebaseAuth();
  await auth?.authStateReady();
  return (await auth?.currentUser?.getIdToken()) ?? null;
}

export async function signOut(): Promise<void> {
  const s = memory ?? read();
  write(null);
  if (s?.source === "firebase") {
    const auth = await firebaseAuth();
    await auth?.signOut();
  }
}
