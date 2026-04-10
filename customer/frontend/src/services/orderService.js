import { requireSupabaseClient } from "../lib/supabase";
import { asSupabaseError } from "../lib/supabaseErrors";
import { getSession } from "./authService";
import {
  canonicalOrderTypeToLabel,
  canonicalPaymentMethodToLabel,
  canonicalStatusToLabel,
  labelToCanonicalOrderType,
  labelToCanonicalPaymentMethod,
} from "../constants/canonical";
import { validateCheckout } from "./checkoutValidation";

export { validateCheckout };

const CANCELLATION_WINDOW_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["cancelled", "completed", "delivered", "refunded"]);

const STATUS_STEPS_BY_ORDER_TYPE = {
  delivery: ["pending", "preparing", "ready", "out_for_delivery", "delivered"],
  dine_in: ["pending", "preparing", "ready", "completed"],
  pickup: ["pending", "preparing", "ready", "completed"],
  takeout: ["pending", "preparing", "ready", "completed"],
};

function asDbError(error, fallback, options) {
  return asSupabaseError(error, {
    fallbackMessage: fallback || "Database request failed.",
    ...options,
  });
}

async function getUserOrNull() {
  const session = await getSession();
  return session?.user || null;
}

async function requireUser() {
  const user = await getUserOrNull();
  if (!user) throw new Error("You must be signed in to place an order.");
  return user;
}

function toMs(value) {
  return new Date(value).getTime() || 0;
}

function toCanonicalOrderType(value) {
  return labelToCanonicalOrderType(value);
}

function mapOrderRow(row) {
  if (!row) return null;

  return {
    id: String(row.id),
    code: String(row.code || ""),
    customerId: row.customer_id ?? null,
    orderType: String(row.order_type || "takeout"),
    status: String(row.status || "pending"),
    paymentMethod: row.payment_method ?? null,
    paymentStatus: String(row.payment_status || "pending"),
    subtotal: Number(row.subtotal ?? 0),
    discountTotal: Number(row.discount_total ?? 0),
    totalAmount: Number(row.total_amount ?? 0),
    receiptImageUrl: row.receipt_image_url ?? null,
    notes: row.notes ?? null,
    deliveryAddress: row.delivery_address ?? null,
    placedAt: row.placed_at ?? row.created_at ?? new Date().toISOString(),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? row.created_at ?? "",
  };
}

function mapOrderItemRow(row, index) {
  const safe = row || {};
  return {
    id: String(safe.id || `line-${index + 1}`),
    orderId: String(safe.order_id || ""),
    menuItemId: safe.menu_item_id ? String(safe.menu_item_id) : null,
    menuItemCode: safe.menu_item_code ? String(safe.menu_item_code) : null,
    itemName: String(safe.item_name || ""),
    unitPrice: Number(safe.unit_price ?? 0),
    discountAmount: Number(safe.discount_amount ?? 0),
    quantity: Number(safe.quantity ?? 1),
    lineTotal: Number(safe.line_total ?? 0),
    createdAt: safe.created_at ?? "",
  };
}

function mapStatusHistoryRow(row) {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    status: String(row.status || "pending").toLowerCase(),
    changedBy: row.changed_by ?? null,
    note: row.note ?? null,
    changedAt: row.changed_at ?? "",
  };
}

function buildFallbackTimeline(order) {
  if (!order) return [];
  const baseAt = order.placedAt || order.createdAt || new Date().toISOString();
  const updatedAt = order.updatedAt || baseAt;
  const status = String(order.status || "pending").toLowerCase();

  if (status === "pending") return [{ status: "pending", at: baseAt }];
  return [
    { status: "pending", at: baseAt },
    { status, at: updatedAt },
  ];
}

function withUiLabels(order) {
  if (!order) return null;
  const orderType = toCanonicalOrderType(order.orderType);
  const status = String(order.status || "pending").toLowerCase();
  const paymentMethod = labelToCanonicalPaymentMethod(order.paymentMethod || null);

  return {
    ...order,
    orderType,
    orderTypeLabel: canonicalOrderTypeToLabel(orderType),
    status,
    statusLabel: canonicalStatusToLabel(status),
    paymentMethod,
    paymentMethodLabel: canonicalPaymentMethodToLabel(paymentMethod || "qrph"),
  };
}

async function fetchOrderItems(orderIds) {
  if (!orderIds.length) return [];
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.from("order_items").select("*").in("order_id", orderIds);
  if (error) throw asDbError(error, "Unable to load order items.", { table: "order_items", operation: "select" });
  return Array.isArray(data) ? data : [];
}

async function fetchStatusHistory(orderIds) {
  if (!orderIds.length) return [];
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("order_status_history")
    .select("*")
    .in("order_id", orderIds)
    .order("changed_at", { ascending: true });

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

function attachRelatedData(orderRows, itemRows, historyRows) {
  const itemsByOrderId = itemRows.reduce((acc, row) => {
    const orderId = row.order_id;
    if (!orderId) return acc;
    const key = String(orderId);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());

  const historyByOrderId = historyRows.reduce((acc, row) => {
    const orderId = row.order_id;
    if (!orderId) return acc;
    const key = String(orderId);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());

  return orderRows
    .map((row) => {
      const order = mapOrderRow(row);
      if (!order) return null;

      const orderId = String(order.id);
      const items = (itemsByOrderId.get(orderId) || []).map(mapOrderItemRow);
      const history = (historyByOrderId.get(orderId) || []).map(mapStatusHistoryRow);
      const timeline = history.length ? history.map((entry) => ({ status: entry.status, at: entry.changedAt })) : buildFallbackTimeline(order);

      return withUiLabels({
        ...order,
        items,
        statusTimeline: timeline,
      });
    })
    .filter(Boolean);
}

export function getStatusSteps(orderType) {
  return STATUS_STEPS_BY_ORDER_TYPE[toCanonicalOrderType(orderType)] || STATUS_STEPS_BY_ORDER_TYPE.takeout;
}

export function getStatusLabel(status) {
  return canonicalStatusToLabel(status);
}

export function formatRemainingCancellationTime(remainingSeconds) {
  const safeSeconds = Math.max(0, Number(remainingSeconds || 0));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function getOrderCancellationState(order, now = Date.now()) {
  if (!order) return { canCancel: false, reason: "Order not found." };

  const status = String(order.status || "").toLowerCase();
  if (status === "cancelled") return { canCancel: false, reason: "Order is already cancelled." };
  if (TERMINAL_STATUSES.has(status)) return { canCancel: false, reason: `Order is already ${getStatusLabel(status).toLowerCase()}.` };

  const placedAtMs = toMs(order.placedAt || order.createdAt);
  if (!placedAtMs) return { canCancel: false, reason: "Order timestamp unavailable." };

  const expiresAtMs = placedAtMs + CANCELLATION_WINDOW_MS;
  const remainingMs = expiresAtMs - now;

  if (remainingMs <= 0) {
    return {
      canCancel: false,
      expiresAt: new Date(expiresAtMs).toISOString(),
      remainingSeconds: 0,
      reason: "Cancellation window expired.",
    };
  }

  return {
    canCancel: true,
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

function deriveLineAmounts(item) {
  const unitPrice = Number(item.unitPrice ?? item.originalPrice ?? item.price ?? 0);
  const discountAmount = Number(item.discountAmount ?? 0);
  const quantity = Number(item.qty ?? item.quantity ?? 1);
  const lineTotal = Math.max(unitPrice - discountAmount, 0) * Math.max(1, quantity);

  return { unitPrice, discountAmount, quantity: Math.max(1, quantity), lineTotal };
}

export async function createOrder(orderPayload) {
  await requireUser();
  const supabase = requireSupabaseClient();

  const validation = await validateCheckout(orderPayload);
  if (!validation.isValid) {
    const error = new Error("Checkout validation failed.");
    error.validationErrors = validation.errors;
    throw error;
  }

  const placedAt = new Date().toISOString();
  const canonicalType = toCanonicalOrderType(orderPayload.orderType);
  const paymentMethod = labelToCanonicalPaymentMethod(orderPayload.paymentMethod || orderPayload.payment || "qrph");

  const lineItems = (orderPayload.items || []).map((item) => {
    const amounts = deriveLineAmounts(item);
    return {
      menu_item_id: item.id,
      menu_item_code: String(item.code || ""),
      item_name: String(item.name || item.itemName || ""),
      unit_price: amounts.unitPrice,
      discount_amount: amounts.discountAmount,
      quantity: amounts.quantity,
      line_total: amounts.lineTotal,
    };
  });

  const subtotal = lineItems.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const discountTotal = lineItems.reduce((sum, line) => sum + line.discountAmount * line.quantity, 0);
  const totalAmount = Math.max(subtotal - discountTotal, 0);

  const deliveryAddress = {
    name: orderPayload.customer?.name || "",
    phone: orderPayload.customer?.phone || "",
    email: orderPayload.customer?.email || "",
    address: orderPayload.customer?.address || "",
  };

  const { data, error } = await supabase.rpc("create_customer_order", {
    p_order_type: canonicalType,
    p_payment_method: paymentMethod,
    p_subtotal: subtotal,
    p_discount_total: discountTotal,
    p_total_amount: totalAmount,
    p_receipt_image_url: orderPayload.receiptImageUrl || null,
    p_notes: orderPayload.notes || null,
    p_delivery_address: deliveryAddress,
    p_items: lineItems,
    p_placed_at: placedAt,
  });

  if (error) {
    // Detect missing/undeployed RPC to surface an actionable message.
    const normalized = asSupabaseError(error, {
      fallbackMessage: "Unable to place your order.",
      table: "orders",
      relation: "create_customer_order",
    });

    if (normalized.kind === "missing_rpc" || normalized.kind === "missing_relation") {
      const err = new Error(
        "Order system is not fully deployed. Please apply the Supabase schema (customer/frontend/supabase/unified_schema.sql) so create_customer_order is available."
      );
      err.kind = normalized.kind;
      err.relation = normalized.relation || "create_customer_order";
      throw err;
    }

    throw normalized;
  }

  const payload = data || {};
  const orderRow = payload.order || null;
  const itemRows = Array.isArray(payload.items) ? payload.items : [];
  const historyRows = Array.isArray(payload.history) ? payload.history : [];

  const merged = attachRelatedData([orderRow], itemRows, historyRows);
  return merged[0] || null;
}

export async function cancelOrder(order, note = "Cancelled by customer within allowed window") {
  const user = await requireUser();
  const supabase = requireSupabaseClient();

  const existingOrder = typeof order === "string" ? await getOrderById(order) : order;
  if (!existingOrder) throw new Error("Order not found.");

  const cancellationState = getOrderCancellationState(existingOrder);
  if (!cancellationState.canCancel) throw new Error(cancellationState.reason || "Cancellation is no longer allowed.");

  const { data: updatedRow, error } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", existingOrder.id)
    .eq("customer_id", user.id)
    .select("*")
    .single();

  if (error) throw asDbError(error, "Unable to cancel this order.", { table: "orders", operation: "update" });

  try {
    await supabase.from("order_status_history").insert({
      order_id: existingOrder.id,
      status: "cancelled",
      changed_by: user.id,
      note,
      changed_at: new Date().toISOString(),
    });
  } catch {
    // best effort
  }

  const [items, history] = await Promise.all([fetchOrderItems([updatedRow.id]), fetchStatusHistory([updatedRow.id])]);
  return attachRelatedData([updatedRow], items, history)[0] || null;
}

export async function getLatestOrder() {
  const user = await getUserOrNull();
  if (!user) return null;

  const supabase = requireSupabaseClient();
  const { data: rows, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", user.id)
    .order("placed_at", { ascending: false })
    .limit(1);

  if (error) throw asDbError(error, "Unable to load your latest order.", { table: "orders", operation: "select" });

  const orderRow = Array.isArray(rows) ? rows[0] : null;
  if (!orderRow) return null;

  const orderIds = [orderRow.id];
  const [items, history] = await Promise.all([fetchOrderItems(orderIds), fetchStatusHistory(orderIds)]);
  return attachRelatedData([orderRow], items, history)[0] || null;
}

async function getOrderRowByIdOrCode(orderIdOrCode, userId) {
  const supabase = requireSupabaseClient();
  const idFirst = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderIdOrCode)
    .eq("customer_id", userId)
    .maybeSingle();

  if (idFirst.error) throw asDbError(idFirst.error, "Unable to load order.", { table: "orders", operation: "select" });
  if (idFirst.data) return idFirst.data;

  const codeMatch = await supabase
    .from("orders")
    .select("*")
    .eq("code", orderIdOrCode)
    .eq("customer_id", userId)
    .maybeSingle();

  if (codeMatch.error) throw asDbError(codeMatch.error, "Unable to load order.", { table: "orders", operation: "select" });
  return codeMatch.data || null;
}

export async function getOrderById(orderIdOrCode) {
  if (!orderIdOrCode) return null;
  const user = await getUserOrNull();
  if (!user) return null;

  const row = await getOrderRowByIdOrCode(String(orderIdOrCode).trim(), user.id);
  if (!row) return null;

  const orderIds = [row.id];
  const [items, history] = await Promise.all([fetchOrderItems(orderIds), fetchStatusHistory(orderIds)]);
  return attachRelatedData([row], items, history)[0] || null;
}

export async function getOrderHistory() {
  const user = await getUserOrNull();
  if (!user) return [];

  const supabase = requireSupabaseClient();
  const { data: rows, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", user.id)
    .order("placed_at", { ascending: false });

  if (error) throw asDbError(error, "Unable to load your orders.", { table: "orders", operation: "select" });

  const orderRows = Array.isArray(rows) ? rows : [];
  const orderIds = orderRows.map((row) => row.id).filter(Boolean);
  const [items, history] = await Promise.all([fetchOrderItems(orderIds), fetchStatusHistory(orderIds)]);

  const merged = attachRelatedData(orderRows, items, history);
  return merged.sort((a, b) => toMs(b.placedAt) - toMs(a.placedAt));
}

export async function getOrderStatusHistory(orderId) {
  if (!orderId) return [];
  const user = await getUserOrNull();
  if (!user) return [];

  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("order_status_history")
    .select("*")
    .eq("order_id", orderId)
    .order("changed_at", { ascending: true });

  if (error) return [];

  return (Array.isArray(data) ? data : []).map(mapStatusHistoryRow);
}
