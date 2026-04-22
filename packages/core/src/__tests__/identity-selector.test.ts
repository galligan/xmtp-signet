import { describe, expect, test } from "bun:test";
import { SqliteIdentityStore } from "../identity-store.js";
import { resolveIdentitySelector } from "../identity-selector.js";

describe("resolveIdentitySelector", () => {
  test("falls back to the default identity when selector is an empty string", async () => {
    const store = new SqliteIdentityStore(":memory:");
    const created = await store.create(null, "default");
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;

    const updated = await store.setInboxId(created.value.id, "inbox-default");
    expect(updated.isOk()).toBe(true);
    if (!updated.isOk()) return;

    const result = await resolveIdentitySelector(store, "");
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.identityId).toBe(created.value.id);
    expect(result.value.inboxId).toBe("inbox-default");

    store.close();
  });
});
