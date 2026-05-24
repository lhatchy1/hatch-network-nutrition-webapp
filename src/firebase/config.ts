// Firebase project configuration. Values are pulled from Vite env vars so the
// secrets-ish API key stays out of the repo. The Firebase web API key isn't
// actually secret (security is enforced by Firestore rules + locked-down
// sign-up), but keeping it in env vars makes per-environment overrides easy.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function readEnv(): FirebaseEnv | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const cfg = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
  };
  for (const v of Object.values(cfg)) {
    if (!v) return null;
  }
  return cfg;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function isFirebaseConfigured(): boolean {
  return readEnv() !== null;
}

function ensureApp(): FirebaseApp | null {
  if (app) return app;
  const env = readEnv();
  if (!env) return null;
  app = initializeApp(env);
  return app;
}

export function getAuthInstance(): Auth | null {
  if (auth) return auth;
  const a = ensureApp();
  if (!a) return null;
  auth = getAuth(a);
  return auth;
}

export function getDb(): Firestore | null {
  if (db) return db;
  const a = ensureApp();
  if (!a) return null;
  db = getFirestore(a);
  return db;
}
