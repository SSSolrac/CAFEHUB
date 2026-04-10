import { labelToCanonicalPaymentMethod } from "../constants/canonical.js";

export async function validateCheckout(orderPayload) {
  const errors = {};

  if (!orderPayload.items?.length) errors.items = "Your cart is empty.";
  if (!orderPayload.customer?.name?.trim()) errors.name = "Name is required.";
  const phone = String(orderPayload.customer?.phone || "").trim();
  if (!phone) {
    errors.phone = "Phone number is required.";
  } else if (!/^\+639\d{9}$/.test(phone)) {
    errors.phone = "Use a valid PH mobile number (e.g., +639123456789).";
  }
  if (!orderPayload.customer?.address?.trim()) errors.address = "Address is required.";

  const paymentMethod = labelToCanonicalPaymentMethod(orderPayload.paymentMethod || orderPayload.payment);
  if (!["qrph", "gcash", "maribank", "bdo", "cash"].includes(paymentMethod || "")) {
    errors.paymentMethod = "Select a valid payment method.";
  }

  if (!String(orderPayload.receiptImageUrl || "").trim()) {
    errors.receipt = "Receipt upload is required.";
  }

  const missingCode = (orderPayload.items || []).some((item) => !String(item.code || "").trim());
  if (missingCode) errors.items = "Menu item code is missing. Refresh the menu and try again.";

  return { isValid: Object.keys(errors).length === 0, errors };
}
