import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { VerificationModal } from "../modal";
import type { DiditSdkConfiguration, VerificationEvent } from "../types";

interface ModalInternals {
  iframe: HTMLIFrameElement | null;
}

function getIframe(modal: VerificationModal): HTMLIFrameElement {
  const iframe = (modal as unknown as ModalInternals).iframe;
  if (!iframe) throw new Error("Modal has no iframe");
  return iframe;
}

function dispatchMessage(source: Window | null, data: unknown, origin = "https://verify.didit.me"): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as WindowProxy | null }));
}

// showExitConfirmation disabled so Escape drives onCloseConfirmed directly,
// without an intermediate confirmation dialog, keeping these tests focused.
const noConfirmConfig: DiditSdkConfiguration = { showExitConfirmation: false };

function createModal(): {
  modal: VerificationModal;
  onMessage: jest.Mock<(event: VerificationEvent) => void>;
  onCloseConfirmed: jest.Mock<() => void>;
} {
  const onMessage = jest.fn();
  const onCloseConfirmed = jest.fn();
  const modal = new VerificationModal(noConfirmConfig, {
    onClose: () => {},
    onCloseConfirmed,
    onMessage,
    onIframeLoad: () => {}
  });
  return { modal, onMessage, onCloseConfirmed };
}

describe("VerificationModal cross-modal isolation", () => {
  const openModals: VerificationModal[] = [];

  afterEach(() => {
    openModals.forEach((modal) => modal.destroy());
    openModals.length = 0;
    document.body.style.overflow = "";
  });

  it("only delivers a postMessage to the modal whose iframe is the event source", () => {
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);
    a.modal.open("https://verify.didit.me/session/a");
    b.modal.open("https://verify.didit.me/session/b");

    dispatchMessage(getIframe(a.modal).contentWindow, { type: "didit:completed", timestamp: 1 });

    expect(a.onMessage).toHaveBeenCalledTimes(1);
    expect(b.onMessage).not.toHaveBeenCalled();
  });

  it("ignores a message whose source does not match this modal's iframe", () => {
    const a = createModal();
    openModals.push(a.modal);
    a.modal.open("https://verify.didit.me/session/a");

    // Source is the top window itself, not the modal's iframe.
    dispatchMessage(window, { type: "didit:completed", timestamp: 1 });

    expect(a.onMessage).not.toHaveBeenCalled();
  });

  it("stops delivering messages after close(), and resumes once re-opened", () => {
    const a = createModal();
    openModals.push(a.modal);
    a.modal.open("https://verify.didit.me/session/a");
    const firstIframeWindow = getIframe(a.modal).contentWindow;

    a.modal.close();
    dispatchMessage(firstIframeWindow, { type: "didit:completed", timestamp: 1 });
    expect(a.onMessage).not.toHaveBeenCalled();

    a.modal.open("https://verify.didit.me/session/a-2");
    dispatchMessage(getIframe(a.modal).contentWindow, { type: "didit:completed", timestamp: 2 });
    expect(a.onMessage).toHaveBeenCalledTimes(1);
  });

  it("only the topmost open modal reacts to Escape", () => {
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);
    a.modal.open("https://verify.didit.me/session/a");
    b.modal.open("https://verify.didit.me/session/b");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(b.onCloseConfirmed).toHaveBeenCalledTimes(1);
    expect(a.onCloseConfirmed).not.toHaveBeenCalled();
  });

  it("restores the body overflow value observed at open() instead of unconditionally clearing it", () => {
    document.body.style.overflow = "";
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);

    a.modal.open("https://verify.didit.me/session/a");
    expect(document.body.style.overflow).toBe("hidden");

    b.modal.open("https://verify.didit.me/session/b");
    expect(document.body.style.overflow).toBe("hidden");

    // Closing the later-opened modal must not clobber the scroll lock "a" still owns.
    b.modal.close();
    expect(document.body.style.overflow).toBe("hidden");

    a.modal.close();
    expect(document.body.style.overflow).toBe("");
  });

  it("falls back to Escape acting on the remaining modal once the topmost one closes", () => {
    const a = createModal();
    const b = createModal();
    openModals.push(a.modal, b.modal);
    a.modal.open("https://verify.didit.me/session/a");
    b.modal.open("https://verify.didit.me/session/b");

    b.modal.close();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(a.onCloseConfirmed).toHaveBeenCalledTimes(1);
  });
});
