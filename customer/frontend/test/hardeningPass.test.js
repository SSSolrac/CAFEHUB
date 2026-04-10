import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSupabaseError } from "../src/lib/supabaseErrors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => readFile(path.join(__dirname, "..", relativePath), "utf8");

test("profiles: frontend does not insert profiles rows (trigger-only)", async () => {
  const src = await readSource("src/services/profileService.js");
  assert.ok(!src.includes('.from("profiles").insert'), "profileService must not insert into profiles");
  assert.ok(src.includes("waitForProfileRow"), "profileService should use fetch-or-wait logic");
  assert.ok(src.includes("handle_new_user_profile"), "profileService should reference trigger-based creation in its error message");
});

test("orders: customer app uses transactional RPC and avoids DELETE", async () => {
  const src = await readSource("src/services/orderService.js");
  assert.ok(src.includes('create_customer_order'), "orderService should call transactional RPC for order creation");
  assert.ok(!src.includes('.from("orders").delete'), "orderService must not delete orders (RLS forbids customer DELETE)");
});

test("orders: tracking/history tolerates missing status history", async () => {
  const src = await readSource("src/services/orderService.js");
  assert.ok(src.includes("buildFallbackTimeline"), "orderService should include a fallback timeline builder");
  assert.ok(src.includes("history.length ? history.map"), "orderService should derive timeline from history when present");
  assert.ok(src.includes("buildFallbackTimeline(order)"), "orderService should fall back to a synthesized timeline when history is empty");
});

test("errors: missing RPC is classified and surfaced", async () => {
  const src = await readSource("src/lib/supabaseErrors.js");
  assert.ok(src.includes("missing_rpc"), "supabaseErrors should classify missing RPCs");

  const orderServiceSrc = await readSource("src/services/orderService.js");
  assert.ok(orderServiceSrc.includes("create_customer_order"), "orderService should target create_customer_order");
  assert.ok(orderServiceSrc.toLowerCase().includes("missing_rpc"), "orderService should detect missing_rpc and surface actionable message");
});

test("menu: categoryId is treated as UUID only (no legacy fallbacks)", async () => {
  const src = await readSource("src/services/menuService.js");
  assert.ok(src.includes("row.category_id"), "menuService must use menu_items.category_id");
  assert.ok(src.includes("isUuid"), "menuService should validate UUID category ids");
  assert.ok(!src.includes("category_name"), "menuService must not map categoryName -> categoryId");
  assert.ok(!src.includes("category_title"), "menuService must not map categoryTitle -> categoryId");
});

test("auth: getSession validates with getUser and clears invalid local auth", async () => {
  const src = await readSource("src/services/authService.js");
  assert.ok(src.includes(".auth.getUser"), "authService.getSession should validate sessions with supabase.auth.getUser()");
  assert.ok(src.includes('signOut({ scope: "local" })'), "authService should prefer local-only signOut to clear stale auth");
});

test("error mapper: classifies missing column", () => {
  const err = {
    message: 'column "total_amount" of relation "public.orders" does not exist',
    code: "42703",
    status: 400,
  };

  const normalized = normalizeSupabaseError(err, { fallbackMessage: "Unable to load orders.", table: "orders" });
  assert.equal(normalized.kind, "missing_column");
  assert.ok(normalized.message.toLowerCase().includes("missing"));
});

test("error mapper: classifies auth failures", () => {
  const err = {
    message: "Invalid JWT",
    status: 401,
  };

  const normalized = normalizeSupabaseError(err, { fallbackMessage: "Unable to restore session." });
  assert.equal(normalized.kind, "auth_failure");
  assert.ok(normalized.message.toLowerCase().includes("sign in"));
});

test("error mapper: classifies network failures", () => {
  const normalized = normalizeSupabaseError(new TypeError("Failed to fetch"), { fallbackMessage: "Unable to validate session." });
  assert.equal(normalized.kind, "network_failure");
  assert.ok(normalized.message.toLowerCase().includes("network"));
});
