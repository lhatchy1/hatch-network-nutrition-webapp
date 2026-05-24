import {
  doc,
  onSnapshot,
  setDoc,
  getDoc,
  type Unsubscribe,
} from "firebase/firestore";
import type { AppState } from "../types";
import { getDb } from "./config";
import {
  normalise,
  setOnSave,
  setStorageScope,
  load,
  loadFromScope,
  clearSignedOutScope,
} from "../state";
import { snapshot, getStore, reseedStore } from "../store";
import { onAuthChange } from "./auth";

interface SyncState {
  uid: string;
  unsubscribe: Unsubscribe;
  applyingRemote: boolean;
  lastPushed: string;
}

let active: SyncState | null = null;
let onReconcileNeeded: ((opts: ReconcileOptions) => Promise<ReconcileChoice>) | null = null;
let renderHook: (() => void) | null = null;

export interface ReconcileOptions {
  hasLocal: boolean;
  hasRemote: boolean;
}

export type ReconcileChoice = "use-cloud" | "push-local" | "cancel";

export function setReconcilePrompt(
  prompt: (opts: ReconcileOptions) => Promise<ReconcileChoice>,
): void {
  onReconcileNeeded = prompt;
}

export function setRenderHook(hook: () => void): void {
  renderHook = hook;
}

function userDocRef(uid: string) {
  const db = getDb();
  if (!db) return null;
  return doc(db, "users", uid, "state", "main");
}

// Called when the auth user changes (initialised once at boot).
export function initSync(): void {
  onAuthChange(async (user) => {
    if (active) {
      active.unsubscribe();
      active = null;
    }
    setOnSave(null);

    if (!user) {
      // Signed out — drop back to the signed-out localStorage namespace.
      setStorageScope(null);
      reseedStore(load());
      renderHook?.();
      return;
    }

    setStorageScope(user.uid);

    // First check the per-uid cache; if empty, also peek at the signed-out
    // scope (data the user may have entered before creating an account).
    let local = load();
    let localFromSignedOut = false;
    if (isEmptyState(local)) {
      const signedOut = loadFromScope(null);
      if (!isEmptyState(signedOut)) {
        local = signedOut;
        localFromSignedOut = true;
      }
    }
    const localEmpty = isEmptyState(local);

    // Render the cached state immediately so sign-in feels instant. The
    // remote read below can take several seconds on a cold Firestore
    // transport (the benign "client is offline" warning), and we don't want
    // the user staring at the sign-in form while it warms up.
    reseedStore(local);
    renderHook?.();

    const ref = userDocRef(user.uid);
    if (!ref) return;

    let remote: AppState | null = null;
    try {
      const remoteSnap = await getDoc(ref);
      if (remoteSnap.exists()) {
        const data = remoteSnap.data() as { state?: unknown };
        if (data?.state) remote = normalise(data.state);
      }
    } catch (err) {
      console.warn("Failed to read remote state", err);
    }

    let chosen: AppState;
    if (remote && !localEmpty && !sameState(local, remote)) {
      // Both have data — ask the user which way to reconcile.
      const choice = onReconcileNeeded
        ? await onReconcileNeeded({ hasLocal: true, hasRemote: true })
        : "use-cloud";
      if (choice === "push-local") {
        chosen = local;
        await pushNow(ref, local);
        if (localFromSignedOut) clearSignedOutScope();
      } else {
        // Default to cloud (also when user cancels) — safer for multi-device.
        chosen = remote;
      }
    } else if (remote) {
      chosen = remote;
    } else if (!localEmpty) {
      // No remote yet — push current local data up.
      chosen = local;
      await pushNow(ref, local);
      if (localFromSignedOut) clearSignedOutScope();
    } else {
      chosen = local;
    }

    // Skip the reseed/re-render if the chosen state matches what's already
    // in the store from the immediate render above — avoids a flash.
    const current = snapshot(getStore());
    const chosenChanged = !sameState(current, chosen);
    if (chosenChanged) reseedStore(chosen);

    // Subscribe to live updates from other devices.
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as { state?: unknown };
      if (!data?.state) return;
      const next = normalise(data.state);
      if (active && sameState(snapshot(getStore()), next)) return;
      if (active) {
        // Mark lastPushed before the reseed so the Alpine-effect save that
        // follows doesn't re-push the value we just received.
        active.lastPushed = JSON.stringify(next);
        active.applyingRemote = true;
      }
      reseedStore(next);
      renderHook?.();
      if (active) active.applyingRemote = false;
    });

    active = {
      uid: user.uid,
      unsubscribe,
      applyingRemote: false,
      lastPushed: JSON.stringify(chosen),
    };

    // Mirror every local save up to Firestore.
    setOnSave((state) => {
      if (!active || active.applyingRemote) return;
      const json = JSON.stringify(state);
      if (json === active.lastPushed) return;
      active.lastPushed = json;
      pushNow(ref, state).catch((err) => {
        console.warn("Failed to push state", err);
      });
    });

    if (chosenChanged) renderHook?.();
  });
}

async function pushNow(
  ref: ReturnType<typeof userDocRef>,
  state: AppState,
): Promise<void> {
  if (!ref) return;
  await setDoc(ref, { state, updatedAt: Date.now() }, { merge: true });
}

function isEmptyState(s: AppState): boolean {
  return (
    s.ingredients.length === 0 &&
    s.meals.length === 0 &&
    s.shoppingChecked.length === 0 &&
    Object.values(s.week).every((day) =>
      Object.values(day).every((v) => v === null),
    )
  );
}

function sameState(a: AppState, b: AppState): boolean {
  // Cheap deep-equal via stable JSON. Both come from snapshot()/normalise()
  // so the key order is consistent.
  return JSON.stringify(a) === JSON.stringify(b);
}
