import americanoHot from "../assets/Americano (Hot).jpg";
import americanoIced from "../assets/Americano (Iced).jpg";
import blueberrySoda from "../assets/Blueberry Soda.jpg";
import caramelMacchiatoFrappe from "../assets/Caramel Macchiato Frappe.jpg";
import caramelMacchiato from "../assets/Caramel Macchiato.jpg";
import chickenPoppers from "../assets/Chicken Poppers with Rice.jpg";
import chocoJavaChip from "../assets/Choco Java Chip Frappe.jpg";
import coffeeIcon from "../assets/coffee.png";
import creamyCarbonara from "../assets/Creamy Carbonara.jpg";
import creamyTunaPesto from "../assets/Creamy Tuna Pesto.jpg";
import fourSeasons from "../assets/Four Seasons.jpg";
import frappeIcon from "../assets/frappe.png";
import greenAppleSoda from "../assets/Green Apple Soda.jpg";
import grilledCheese from "../assets/Grilled Cheese Sandwich.jpg";
import hotChocolate from "../assets/Hot Chocolate.jpg";
import hotIcon from "../assets/hot.png";
import huskyLogo from "../assets/husky-logo.jpg";
import icedChocoMilk from "../assets/Iced Choco Milk.jpg";
import logo from "../assets/logo.png";
import matchaFrappe from "../assets/Matcha Frappe.jpg";
import pattern from "../assets/pattern.png";
import pet1 from "../assets/pet1.jpg";
import pet2 from "../assets/pet2.jpg";
import pet3 from "../assets/pet3.jpg";
import profile from "../assets/profile.png";
import riceMealIcon from "../assets/ricemeal.png";
import sandwichesIcon from "../assets/sandwiches.png";
import sodaIcon from "../assets/soda.png";
import strawberryFrappe from "../assets/Strawberry Frappe.jpg";
import strawberryMilk from "../assets/Strawberry Milk.jpg";
import strawberrySoda from "../assets/Strawberry Soda.jpg";
import toastedHungarian from "../assets/Toasted Cheesy Hungarian Sandwich.jpg";

// Payment/brand assets used elsewhere; keep for compatibility.
import bdo from "../assets/BDO.webp";
import gcash from "../assets/GCASH.webp";
import maribank from "../assets/MARIBANK.webp";
import qrph from "../assets/QRPH.webp";

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const assetEntries = [
  ["Americano (Hot)", americanoHot],
  ["Americano (Iced)", americanoIced],
  ["Blueberry Soda", blueberrySoda],
  ["Caramel Macchiato Frappe", caramelMacchiatoFrappe],
  ["Caramel Macchiato", caramelMacchiato],
  ["Chicken Poppers with Rice", chickenPoppers],
  ["Choco Java Chip Frappe", chocoJavaChip],
  ["coffee", coffeeIcon],
  ["Creamy Carbonara", creamyCarbonara],
  ["Creamy Tuna Pesto", creamyTunaPesto],
  ["Four Seasons", fourSeasons],
  ["frappe", frappeIcon],
  ["Green Apple Soda", greenAppleSoda],
  ["Grilled Cheese Sandwich", grilledCheese],
  ["Hot Chocolate", hotChocolate],
  ["hot", hotIcon],
  ["husky-logo", huskyLogo],
  ["Iced Choco Milk", icedChocoMilk],
  ["logo", logo],
  ["Matcha Frappe", matchaFrappe],
  ["pattern", pattern],
  ["pet1", pet1],
  ["pet2", pet2],
  ["pet3", pet3],
  ["profile", profile],
  ["ricemeal", riceMealIcon],
  ["sandwiches", sandwichesIcon],
  ["soda", sodaIcon],
  ["Strawberry Frappe", strawberryFrappe],
  ["Strawberry Milk", strawberryMilk],
  ["Strawberry Soda", strawberrySoda],
  ["Toasted Cheesy Hungarian Sandwich", toastedHungarian],
  // payment/brand assets
  ["bdo", bdo],
  ["gcash", gcash],
  ["maribank", maribank],
  ["qrph", qrph],
].map(([label, url]) => ({ key: normalizeKey(label), url }));

const urlByKey = new Map(assetEntries.map((entry) => [entry.key, entry.url]));

function bestContainsMatch(nameKey) {
  if (!nameKey) return null;

  let best = null;
  for (const entry of assetEntries) {
    if (!entry.key.includes(nameKey)) continue;
    if (!best || entry.key.length < best.key.length) best = entry;
  }
  return best?.url || null;
}

export function resolveMenuItemImage(itemName, categoryName = "") {
  const nameKey = normalizeKey(itemName);
  if (!nameKey) return null;

  const categoryKey = normalizeKey(categoryName);
  const variant = categoryKey.includes("iced") ? "iced" : categoryKey.includes("hot") ? "hot" : "";

  const candidates = [];
  if (variant) candidates.push(normalizeKey(`${itemName} ${variant}`));
  candidates.push(nameKey);

  for (const candidate of candidates) {
    const url = urlByKey.get(candidate);
    if (url) return url;
  }

  return bestContainsMatch(nameKey);
}
