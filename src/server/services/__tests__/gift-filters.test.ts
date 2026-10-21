/**
 * @jest-environment node
 *
 * Unit tests for gift search and filter support (status, from, to, q)
 * on getGiftsBySenderPaginated / getGiftsBySenderPage and giftFilterSchema.
 */

jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock("@/lib/paystack", () => ({}));
jest.mock("@/lib/sms", () => ({}));
jest.mock("@/lib/email", () => ({}));
jest.mock("@/server/config", () => ({ serverConfig: {} }));
jest.mock("@/server/services/exchange-rate.service", () => ({}));
jest.mock("@/server/services/audit.service", () => ({}));
jest.mock("@/server/services/invitation.service", () => ({}));

import type { Gift, GiftStatus } from "@/types";
import { giftFilterSchema } from "@/types/schemas";
import {
  gifts,
  getGiftsBySenderPaginated,
  getGiftsBySenderPage,
} from "@/server/services/gift.service";

const SENDER = "sender-1";

function seed(
  id: string,
  status: GiftStatus,
  createdAt: string,
  message?: string,
  senderId = SENDER
) {
  gifts.set(id, { id, senderId, status, createdAt: new Date(createdAt), message } as Gift);
}

beforeEach(() => {
  gifts.clear();
  seed("a", "funded", "2026-01-01T00:00:00Z", "Happy Birthday!");
  seed("b", "claimed", "2026-02-01T00:00:00Z", "Congrats on the new job");
  seed("c", "funded", "2026-03-01T00:00:00Z", "birthday vibes");
  seed("d", "funded", "2026-03-01T00:00:00Z", "Happy birthday", "other-sender");
});

const ids = (list: Gift[]) => list.map((g) => g.id).sort();
const parse = (input: Record<string, string>) => giftFilterSchema.parse(input);

describe("gift filters", () => {
  it("filters by status", async () => {
    const page = await getGiftsBySenderPaginated(SENDER, null, 10, parse({ status: "funded" }));
    expect(ids(page.gifts)).toEqual(["a", "c"]);
    expect(page.total).toBe(2);
  });

  it("filters by from date", async () => {
    const page = await getGiftsBySenderPaginated(SENDER, null, 10, parse({ from: "2026-02-01" }));
    expect(ids(page.gifts)).toEqual(["b", "c"]);
  });

  it("filters by to date", async () => {
    const page = await getGiftsBySenderPaginated(SENDER, null, 10, parse({ to: "2026-01-15" }));
    expect(ids(page.gifts)).toEqual(["a"]);
  });

  it("q matches message case-insensitively and is scoped to the sender", async () => {
    const page = await getGiftsBySenderPaginated(SENDER, null, 10, parse({ q: "BIRTHDAY" }));
    expect(ids(page.gifts)).toEqual(["a", "c"]);
  });

  it("combines filters with cursor pagination", async () => {
    const filters = parse({
      status: "funded",
      q: "birthday",
      from: "2025-12-01",
      to: "2026-12-31",
    });
    const first = await getGiftsBySenderPaginated(SENDER, null, 1, filters);
    expect(ids(first.gifts)).toEqual(["c"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await getGiftsBySenderPaginated(SENDER, first.nextCursor, 1, filters);
    expect(ids(second.gifts)).toEqual(["a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("applies filters to offset pagination", async () => {
    const result = await getGiftsBySenderPage(SENDER, 1, 10, parse({ status: "claimed" }));
    expect(ids(result.data)).toEqual(["b"]);
  });

  it("rejects invalid params", () => {
    expect(giftFilterSchema.safeParse({ status: "bogus" }).success).toBe(false);
    expect(giftFilterSchema.safeParse({ from: "not-a-date" }).success).toBe(false);
    expect(giftFilterSchema.safeParse({ from: "2026-03-01", to: "2026-01-01" }).success).toBe(
      false
    );
  });
});
