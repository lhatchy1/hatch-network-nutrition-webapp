// Camera-based barcode scanner. Opens a modal with a live video preview,
// decodes EAN/UPC barcodes with @zxing/browser, and resolves the first hit.
//
// Caller is responsible for what happens with the decoded barcode (typically
// an OFF lookup). This module just owns the camera lifecycle and the modal.

import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import type { IScannerControls } from "@zxing/browser";
import { html, raw } from "./components";

export interface ScannerCallbacks {
  onResult: (barcode: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

// Only the retail barcodes OFF actually uses — skipping the rest keeps
// false-positive decodes (QR, Code 128 on the packaging copy, etc.) out.
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

export async function openBarcodeScanner(cb: ScannerCallbacks): Promise<void> {
  // Secure-context check first — on iOS Safari, navigator.mediaDevices is
  // undefined on plain HTTP, which used to surface as a generic "can't
  // access" message. Be specific so the user knows it's an HTTPS issue,
  // not a permissions one.
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    cb.onError(
      "Camera access needs HTTPS. Open this page at https:// (check that food.hatchnetwork.ch shows a padlock in the address bar).",
    );
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    cb.onError("This browser doesn't support camera access.");
    return;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "scanner-dialog";
  dialog.innerHTML = html`
    <article class="scanner-shell">
      <header class="scanner-head">
        <strong>Scan a barcode</strong>
        <button class="outline secondary" data-cancel>Cancel</button>
      </header>
      <div class="scanner-stage">
        <video data-video playsinline muted autoplay></video>
        <div class="scanner-reticle"></div>
      </div>
      <p class="muted scanner-hint" data-hint>
        <small>Point the rear camera at the barcode on the package.</small>
      </p>
      ${raw("")}
    </article>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();

  const video = dialog.querySelector<HTMLVideoElement>("[data-video]")!;
  const hint = dialog.querySelector<HTMLElement>("[data-hint]")!;
  const cancelBtn = dialog.querySelector<HTMLButtonElement>("[data-cancel]")!;

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);

  let controls: IScannerControls | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controls?.stop();
    } catch {
      // ignore — best-effort cleanup
    }
    if (dialog.open) dialog.close();
    dialog.remove();
  };

  cancelBtn.addEventListener("click", () => {
    close();
    cb.onCancel();
  });

  // ESC and backdrop click both close the dialog. <dialog>'s built-in cancel
  // event covers ESC; we wire a manual backdrop check too.
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
    cb.onCancel();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      close();
      cb.onCancel();
    }
  });

  try {
    controls = await reader.decodeFromVideoDevice(
      undefined, // pick the default device; the constraint below biases to rear-facing
      video,
      (result, err) => {
        if (closed) return;
        if (result) {
          const text = result.getText();
          close();
          cb.onResult(text);
          return;
        }
        // decodeFromVideoDevice fires the callback every frame; absent a
        // hit it passes a NotFoundException we should ignore so the loop
        // keeps running.
        if (err && (err as { name?: string }).name !== "NotFoundException") {
          console.warn("Barcode decode error", err);
        }
      },
    );
    // Prefer the rear camera on phones/tablets where the user actually wants
    // to point at a product. decodeFromVideoDevice defaults to the front
    // camera on some devices, so override with a facingMode constraint.
    const stream = video.srcObject as MediaStream | null;
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track && "applyConstraints" in track) {
        track.applyConstraints({ facingMode: { ideal: "environment" } }).catch(() => {
          // Front camera will still work — just less convenient.
        });
      }
    }
  } catch (err) {
    close();
    const name = (err as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      cb.onError("Camera permission denied. Allow access and try again.");
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      cb.onError("No camera found on this device.");
    } else {
      console.error(err);
      cb.onError("Couldn't start the camera.");
    }
    return;
  }

  // Helpful nudge for new users — only shown if no decode after ~5 s.
  setTimeout(() => {
    if (!closed) {
      hint.innerHTML = `<small>Hold steady — make sure the whole barcode is inside the frame.</small>`;
    }
  }, 5000);
}
