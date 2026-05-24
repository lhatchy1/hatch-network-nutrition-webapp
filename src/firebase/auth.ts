import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getAuthInstance, isFirebaseConfigured } from "./config";

let current: User | null = null;
const listeners = new Set<(user: User | null) => void>();

export function initAuth(): void {
  const auth = getAuthInstance();
  if (!auth) return;
  onAuthStateChanged(auth, (user) => {
    current = user;
    for (const l of listeners) {
      try {
        l(user);
      } catch (err) {
        console.warn("auth listener failed", err);
      }
    }
  });
}

export function currentUser(): User | null {
  return current;
}

export function onAuthChange(fn: (user: User | null) => void): () => void {
  listeners.add(fn);
  // Push current value immediately so callers don't have to special-case
  // "what's my starting state?".
  try {
    fn(current);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

export async function signIn(email: string, password: string): Promise<void> {
  const auth = getAuthInstance();
  if (!auth) throw new Error("Firebase isn't configured.");
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOut(): Promise<void> {
  const auth = getAuthInstance();
  if (!auth) return;
  await fbSignOut(auth);
}

export function authReady(): boolean {
  return isFirebaseConfigured();
}
