import { esc, html } from "./components";
import { signIn } from "../firebase/auth";
import { isFirebaseConfigured } from "../firebase/config";

// Renders the signed-out experience: a sign-in form occupying the main view.
// Deliberately has no "create account" link — accounts are provisioned in the
// Firebase console.
export function renderAuthGate(target: HTMLElement): void {
  if (!isFirebaseConfigured()) {
    target.innerHTML = html`
      <article>
        <header><h2>Sign-in unavailable</h2></header>
        <p>Firebase isn't configured for this deployment. Set <code>VITE_FIREBASE_*</code> env vars and rebuild.</p>
      </article>
    `;
    return;
  }

  target.innerHTML = html`
    <article class="auth-card">
      <header>
        <h2>Sign in</h2>
        <p class="muted"><small>Accounts are invite-only — ask Liam for one.</small></p>
      </header>
      <form id="signin-form">
        <label>Email
          <input type="email" name="email" required autocomplete="username" />
        </label>
        <label>Password
          <input type="password" name="password" required autocomplete="current-password" />
        </label>
        <p id="signin-error" class="auth-error" hidden></p>
        <button type="submit" id="signin-submit">Sign in</button>
      </form>
    </article>
  `;

  const form = target.querySelector<HTMLFormElement>("#signin-form");
  const errorEl = target.querySelector<HTMLElement>("#signin-error");
  const submit = target.querySelector<HTMLButtonElement>("#signin-submit");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!errorEl || !submit) return;
    errorEl.hidden = true;
    submit.disabled = true;
    submit.textContent = "Signing in…";
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    try {
      await signIn(email, password);
      // The auth observer will swap the view; no further action needed here.
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
      errorEl.hidden = false;
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
}

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  ) {
    return "Email or password is incorrect.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Try again in a few minutes.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error. Check your connection and retry.";
  }
  return esc(err instanceof Error ? err.message : String(err));
}
