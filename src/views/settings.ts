import { getStore, replaceState, snapshot } from "../store";
import { clearStorage, defaultState, exportFilename, validateImport } from "../state";
import { esc, html, raw, confirmAction } from "../ui/components";
// Bundled at build time so the in-app prompt and the repo doc never drift.
import importPrompt from "../../IMPORT.md?raw";

export function openSettings(dialog: HTMLDialogElement, onChange: () => void): void {
  const store = getStore();

  dialog.innerHTML = html`
    <article>
      <header>
        <button aria-label="Close" rel="prev" id="settings-close"></button>
        <h3>Settings</h3>
      </header>
      <h4>Daily targets</h4>
      <div class="row">
        <label class="grow">kcal
          <input id="set-kcal" type="number" min="0" step="50" value="${store.targets.kcal}" />
        </label>
        <label class="grow">protein (g)
          <input id="set-protein" type="number" min="0" step="5" value="${store.targets.protein}" />
        </label>
      </div>

      <h4>Backup & restore</h4>
      <div class="row">
        <button id="export-btn">Export JSON</button>
        <button id="import-btn" class="outline">Import JSON…</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden />
      </div>
      <p class="muted"><small>Drop the exported file in iCloud/Drive to sync between devices.</small></p>

      <h4>Generate JSON with a chat</h4>
      <p class="muted"><small>Copies a self-contained schema + example brief. Paste into any chat, describe your week, and import the JSON it produces.</small></p>
      <button id="copy-prompt-btn" class="outline">Copy import prompt</button>

      <h4>Reset</h4>
      <button id="reset-btn" class="outline secondary">Reset all data</button>
      ${raw("")}
    </article>
  `;

  if (!dialog.open) dialog.showModal();

  dialog.querySelector("#settings-close")?.addEventListener("click", () => dialog.close());

  (dialog.querySelector("#set-kcal") as HTMLInputElement).addEventListener("change", (e) => {
    store.targets.kcal = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
    onChange();
  });
  (dialog.querySelector("#set-protein") as HTMLInputElement).addEventListener("change", (e) => {
    store.targets.protein = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
    onChange();
  });

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
      const next = validateImport(parsed);
      if (!next) {
        alert("That file doesn't look like a valid Meal Prep export.");
        return;
      }
      if (!confirmAction("Importing will overwrite all current data. Continue?")) return;
      replaceState(next);
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
    if (!confirmAction("Delete all ingredients, meals, and the week plan? This can't be undone.")) return;
    clearStorage();
    replaceState(defaultState());
    onChange();
    dialog.close();
  });

  // ESC handler is built into <dialog>; close on backdrop click.
  dialog.addEventListener(
    "click",
    (e) => {
      const rect = (dialog.querySelector("article") as HTMLElement).getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) dialog.close();
    },
    { once: true },
  );
}

export { esc };
