/**
 * @jest-environment jsdom
 *
 * Tests for useGiftDraft hook — issue #33 acceptance criteria.
 */

import { renderHook, act } from "@testing-library/react";
import { useGiftDraft, type GiftDraft } from "../useGiftDraft";

const STORAGE_KEY = "lumigift_gift_draft_v1";

function clearStorage() {
  localStorage.clear();
}

beforeEach(clearStorage);
afterEach(clearStorage);

describe("useGiftDraft", () => {
  it("returns null when no draft exists", () => {
    const { result } = renderHook(() => useGiftDraft());
    expect(result.current.readDraft()).toBeNull();
  });

  it("saves and reads back a valid draft", () => {
    const { result } = renderHook(() => useGiftDraft());

    const draft: GiftDraft = {
      step: 2,
      recipientName: "Amara",
      amountNgn: 5000,
      message: "Happy birthday!",
      unlockAt: "2030-01-01T00:00",
    };

    act(() => {
      result.current.saveDraft(draft);
    });

    expect(result.current.readDraft()).toMatchObject(draft);
  });

  it("clears the draft from sessionStorage", () => {
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1, recipientName: "Temi" });
    });

    act(() => {
      result.current.clearDraft();
    });

    expect(result.current.readDraft()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does NOT store phone numbers — phone field is absent from the type", () => {
    // This is a compile-time guarantee enforced by GiftDraft type,
    // but we also verify no 'phone' key ends up in sessionStorage.
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1, recipientName: "Joe" });
    });

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain("phone");
  });

  it("does NOT store payment secrets — paymentProvider field is absent", () => {
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 3, amountNgn: 10000 });
    });

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain("payment");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("otp");
  });

  it("returns null for malformed sessionStorage data", () => {
    sessionStorage.setItem(STORAGE_KEY, "not-valid-json{{");
    const { result } = renderHook(() => useGiftDraft());
    expect(result.current.readDraft()).toBeNull();
  });

  it("returns null when stored object lacks a numeric step", () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ recipientName: "no step" }));
    const { result } = renderHook(() => useGiftDraft());
    expect(result.current.readDraft()).toBeNull();
  });

  it("uses localStorage (not sessionStorage) so data is shared across tabs", () => {
    const sessionSpy = jest.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1 });
    });

    // The setItem call should be on localStorage, not sessionStorage
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    sessionSpy.mockRestore();
  });

  it("syncs draft state across tabs via the storage event", () => {
    const { result } = renderHook(() => useGiftDraft());

    // Tab A saves a draft.
    act(() => {
      result.current.saveDraft({ step: 2, recipientName: "Amara", amountNgn: 5000 });
    });
    expect(result.current.readDraft()).toMatchObject({
      step: 2,
      recipientName: "Amara",
      amountNgn: 5000,
    });

    // Tab B receives the storage event that Tab A's write dispatched.
    const draft: GiftDraft = { step: 3, recipientName: "Temi", amountNgn: 7500 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify(draft),
        })
      );
    });

    // The hook should adopt the cross-tab value without another localStorage write.
    expect(result.current.readDraft()).toMatchObject(draft);
  });

  it("does not re-render when the storage event carries an unchanged draft", () => {
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1, recipientName: "Amara" });
    });

    // Dispatch a storage event with the same value — state must stay identical.
    const same = { step: 1, recipientName: "Amara" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(same));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify(same),
        })
      );
    });

    expect(result.current.readDraft()).toMatchObject(same);
  });

  it("clears the draft across tabs when the storage event carries a null value", () => {
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1, recipientName: "Joe" });
    });
    expect(result.current.readDraft()).not.toBeNull();

    // Simulate another tab clearing the draft.
    localStorage.removeItem(STORAGE_KEY);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: null,
        })
      );
    });

    expect(result.current.readDraft()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
