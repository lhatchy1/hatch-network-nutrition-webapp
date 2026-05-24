import { getStore, replaceState, snapshot } from "../store";
import {
  clearStorage,
  defaultState,
  exportFilename,
  mergeImport,
  validateImport,
  uid as newId,
} from "../state";
import { esc, html, raw, confirmAction } from "../ui/components";
import type { MealSlot, ThemePref } from "../types";
import { currentUser, signOut as authSignOut } from "../firebase/auth";
import {
  syncNow,
  getLastSyncedAt,
  isSyncActive,
  onSyncStatusChange,
} from "../firebase/sync";
import importPrompt from "../../IMPORT.md?raw";
import { applyTheme } from "../theme";

interface DialogState {
  editingTarget: keyof ReturnType<typeof getStore>["targets"] | null;
  editingSlotId: string | null;
}
const state: DialogState = { editingTarget: null, editingSlotId: null };

export function openSettings(dialog: HTMLDialogElement, onChange: () => void): void {
  render(dialog, onChange);
  if (!dialog.open) dialog.showModal();

  // Backdrop click → close. Native <dialog> dispatches the click with
  // target === dialog when the backdrop region is hit; inner clicks bubble
  // with the inner element as the target.
  if (!dialog.dataset.backdropBound) {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.dataset.backdropBound = "1";
  }
}

function render(dialog: HTMLDialogElement, onChange: () => void): void {
  const store = getStore();
  const user = currentUser();

  dialog.innerHTML = html`
    <header class="hdr">
      <h2>Settings</h2>
      <button class="close" aria-label="Close" id="settings-close">✕</button>
    </header>
    <div class="body">
      ${raw(user ? renderAccountGroup(user.email ?? "", store.profile.displayName) : "")}

      <!-- Macro targets -->
      <section class="settings-group">
        <div class="grp-h"><span>Daily macro targets</span><span>per day</span></div>
        <div class="macro-target-grid">
          ${raw(macroTile("kcal", "kcal", store.targets.kcal, ""))}
          ${raw(macroTile("protein", "P", store.targets.protein, "g"))}
          ${raw(macroTile("carbs", "C", store.targets.carbs, "g"))}
          ${raw(macroTile("fat", "F", store.targets.fat, "g"))}
        </div>
      </section>

      <!-- Day structure -->
      <section class="settings-group">
        <div class="grp-h"><span>Day structure</span></div>
        ${raw(renderSlotsBlock(store.slots))}
      </section>

      <!-- Appearance -->
      <section class="settings-group">
        <div class="grp-h"><span>Appearance</span></div>
        <div class="row">
          <span class="lbl">Theme</span>
          <div class="seg" role="radiogroup" aria-label="Theme">
            <button class="o ${store.theme === "light" ? "cur" : ""}" data-theme-set="light">Light</button>
            <button class="o ${store.theme === "dark" ? "cur" : ""}" data-theme-set="dark">Dark</button>
            <button class="o ${store.theme === "auto" ? "cur" : ""}" data-theme-set="auto">Auto</button>
          </div>
        </div>
      </section>

      <!-- Data -->
      <section class="settings-group">
        <div class="grp-h"><span>Data</span></div>
        <div class="row">
          <span class="lbl">Export everything (JSON)</span>
          <button class="btn sm" id="export-btn">↓ Export</button>
        </div>
        <div class="row">
          <span class="lbl">Import library JSON</span>
          <button class="btn sm ghost" id="import-btn">Import…</button>
          <input id="import-file" type="file" accept="application/json,.json" hidden />
        </div>
        <div class="row">
          <span class="lbl">Copy import prompt</span>
          <button class="btn sm ghost" id="copy-prompt-btn">Copy</button>
        </div>
        <div class="row danger">
          <span class="lbl">Clear all data</span>
          <button class="btn sm danger" id="reset-btn">Reset</button>
        </div>
      </section>
    </div>
  `;

  wire(dialog, onChange);
}

function renderAccountGroup(email: string, displayName: string): string {
  const syncOn = isSyncActive();
  const last = getLastSyncedAt();
  const status = syncOn
    ? last
      ? `Last synced ${formatRelative(last)}`
      : "Sync ready"
    : "Sync offline";
  return `<section class="settings-group">
    <div class="grp-h"><span>Account</span></div>
    <div class="row">
      <span class="lbl">Signed in as</span>
      <span class="val">${esc(email)}</span>
    </div>
    <div class="row">
      <span class="lbl">Display name</span>
      <input class="inline-input" id="set-display-name" value="${esc(displayName)}" placeholder="(shown on shared items)" />
    </div>
    <div class="row">
      <span class="lbl">Cloud sync</span>
      <span class="val" id="sync-status" style="font-family: var(--font-mono); font-size: 11px;">${esc(status)}</span>
      <button class="btn sm" id="sync-now-btn" ${syncOn ? "" : "disabled"}>↻ Sync now</button>
    </div>
    <div class="row">
      <span class="lbl">Session</span>
      <button class="btn sm ghost" id="sign-out-btn">Sign out</button>
    </div>
  </section>`;
}

function formatRelative(ts: number): string {
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

function macroTile(key: string, label: string, value: number, unit: string): string {
  const editing = state.editingTarget === (key as keyof ReturnType<typeof getStore>["targets"]);
  return `<button class="macro-target" data-edit-target="${esc(key)}">
    <div class="k">${esc(label)}</div>
    ${
      editing
        ? `<input class="v-input" type="number" min="0" step="any" data-target-input="${esc(key)}" value="${value}" autofocus />`
        : `<div class="v">${value.toLocaleString()}${esc(unit)}</div>`
    }
  </button>`;
}

function renderSlotsBlock(slots: MealSlot[]): string {
  return `
    <div class="row" style="border-bottom: 1px solid var(--rule);">
      <span class="lbl">Slots</span>
      <span class="val">${slots.length} per day</span>
    </div>
    <ul class="slot-edit-list">
      ${slots
        .map(
          (s, i) => `<li class="slot-edit-row" data-slot-id="${esc(s.id)}">
            <input data-slot-label="${esc(s.id)}" value="${esc(s.label)}" />
            <button data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button data-down="${i}" ${i === slots.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button class="danger" data-rm="${esc(s.id)}" aria-label="Remove">✕</button>
          </li>`,
        )
        .join("")}
    </ul>
    <div class="slot-edit-row" style="border-bottom: 0;">
      <input id="new-slot-label" placeholder="＋ Add a slot (Breakfast, Snack, …)" />
      <button id="add-slot">Add</button>
    </div>
  `;
}

function wire(dialog: HTMLDialogElement, onChange: () => void): void {
  const store = getStore();
  const rerender = () => {
    render(dialog, onChange);
    onChange();
  };

  dialog.querySelector("#settings-close")?.addEventListener("click", () => dialog.close());

  // Account
  dialog.querySelector("#set-display-name")?.addEventListener("change", (e) => {
    store.profile.displayName = (e.target as HTMLInputElement).value.trim();
  });
  dialog.querySelector("#sign-out-btn")?.addEventListener("click", async () => {
    if (
      !confirmAction(
        "Sign out? Your local data will stay on this device but won't sync until you sign in again.",
      )
    )
      return;
    await authSignOut();
    dialog.close();
  });

  // Manual sync trigger + live status updates while the dialog is open.
  const syncBtn = dialog.querySelector<HTMLButtonElement>("#sync-now-btn");
  syncBtn?.addEventListener("click", async () => {
    if (!isSyncActive()) return;
    syncBtn.disabled = true;
    const original = syncBtn.textContent;
    syncBtn.textContent = "Syncing…";
    try {
      await syncNow();
    } catch (err) {
      console.warn("Manual sync failed", err);
      alert(
        "Sync failed. Check your connection and try again.\n\n" +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      syncBtn.disabled = !isSyncActive();
      syncBtn.textContent = original ?? "↻ Sync now";
    }
  });
  const offSync = onSyncStatusChange(() => {
    const status = dialog.querySelector<HTMLElement>("#sync-status");
    if (!status) return;
    const last = getLastSyncedAt();
    status.textContent = isSyncActive()
      ? last
        ? `Last synced ${formatRelative(last)}`
        : "Sync ready"
      : "Sync offline";
  });
  // Drop the subscription when the dialog closes so we don't pile up
  // listeners across open/close cycles.
  dialog.addEventListener(
    "close",
    () => {
      offSync();
    },
    { once: true },
  );

  // Macro target tiles — tap to edit inline.
  dialog.querySelectorAll<HTMLElement>("[data-edit-target]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const key = el.dataset.editTarget as keyof typeof store.targets;
      state.editingTarget = key;
      rerender();
    });
  });
  dialog.querySelectorAll<HTMLInputElement>("[data-target-input]").forEach((input) => {
    const commit = () => {
      const key = input.dataset.targetInput as keyof typeof store.targets;
      const v = Math.max(0, Number(input.value) || 0);
      store.targets[key] = v;
      state.editingTarget = null;
      rerender();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        state.editingTarget = null;
        rerender();
      }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
    input.focus();
    input.select();
  });

  // Slots
  dialog.querySelectorAll<HTMLInputElement>("[data-slot-label]").forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.dataset.slotLabel!;
      const slot = store.slots.find((s) => s.id === id);
      if (!slot) return;
      const label = el.value.trim();
      if (!label) {
        el.value = slot.label;
        return;
      }
      slot.label = label;
      rerender();
    });
  });
  dialog.querySelectorAll<HTMLElement>("[data-up]").forEach((el) => {
    el.addEventListener("click", () => {
      const i = Number(el.dataset.up);
      if (i <= 0) return;
      const arr = [...store.slots];
      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      store.slots = arr;
      rerender();
    });
  });
  dialog.querySelectorAll<HTMLElement>("[data-down]").forEach((el) => {
    el.addEventListener("click", () => {
      const i = Number(el.dataset.down);
      const arr = [...store.slots];
      if (i >= arr.length - 1) return;
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      store.slots = arr;
      rerender();
    });
  });
  dialog.querySelectorAll<HTMLElement>("[data-rm]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.rm!;
      const slot = store.slots.find((s) => s.id === id);
      if (!slot) return;
      if (
        !confirmAction(
          `Remove "${slot.label}" slot? Meals assigned to it across the week will be unassigned.`,
        )
      )
        return;
      store.slots = store.slots.filter((s) => s.id !== id);
      for (const day of Object.keys(store.week) as (keyof typeof store.week)[]) {
        delete store.week[day][id];
      }
      rerender();
    });
  });
  dialog.querySelector("#add-slot")?.addEventListener("click", () => {
    const input = dialog.querySelector("#new-slot-label") as HTMLInputElement;
    const label = input.value.trim();
    if (!label) {
      input.focus();
      return;
    }
    const id = newId();
    store.slots = [...store.slots, { id, label }];
    for (const day of Object.keys(store.week) as (keyof typeof store.week)[]) {
      store.week[day][id] = null;
    }
    input.value = "";
    rerender();
  });
  dialog.querySelector("#new-slot-label")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      (dialog.querySelector("#add-slot") as HTMLButtonElement).click();
    }
  });

  // Theme
  dialog.querySelectorAll<HTMLButtonElement>("[data-theme-set]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.themeSet as ThemePref;
      store.theme = next;
      applyTheme(next);
      rerender();
    });
  });

  // Data — export / import / reset
  dialog.querySelector("#export-btn")?.addEventListener("click", () => {
    const json = JSON.stringify(snapshot(store), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const fileInput = dialog.querySelector("#import-file") as HTMLInputElement;
  dialog.querySelector("#import-btn")?.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = validateImport(parsed);
      if (!payload) {
        alert("That file doesn't look like a valid ingredients/meals JSON.");
        return;
      }
      const ingN = payload.ingredients.length;
      const mealN = payload.meals.length;
      const summary = `Add ${ingN} ingredient${ingN === 1 ? "" : "s"} and ${mealN} meal${mealN === 1 ? "" : "s"} to your library? Your week plan and slots are untouched.`;
      if (!confirmAction(summary)) return;
      mergeImport(store, payload);
      onChange();
      dialog.close();
    } catch (err) {
      alert("Couldn't read that file: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      fileInput.value = "";
    }
  });

  dialog.querySelector("#copy-prompt-btn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(importPrompt);
      alert("Import prompt copied to clipboard.");
    } catch {
      window.prompt("Copy the import prompt:", importPrompt);
    }
  });

  dialog.querySelector("#reset-btn")?.addEventListener("click", () => {
    if (!confirmAction("Delete all ingredients, meals, and the week plan? This can't be undone."))
      return;
    clearStorage();
    replaceState(defaultState());
    applyTheme(defaultState().theme);
    onChange();
    dialog.close();
  });
}
