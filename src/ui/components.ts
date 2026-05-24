/** Escape a string for safe interpolation into HTML. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tagged-template helper that auto-escapes interpolations. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      // Allow pre-built HTML via the `raw()` wrapper below.
      if (v && typeof v === "object" && "__raw" in v) {
        out += (v as { __raw: string }).__raw;
      } else {
        out += esc(v);
      }
    }
  });
  return out;
}

export function raw(s: string): { __raw: string } {
  return { __raw: s };
}

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
