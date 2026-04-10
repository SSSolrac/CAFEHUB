// src/components/MenuBelt.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getMenuCategories } from "../services/menuService";
import "./MenuBelt.css";

// Default category images
import coffee from "../assets/coffee.png";
import hot from "../assets/hot.png";
import sandwiches from "../assets/sandwiches.png";
import rice from "../assets/ricemeal.png"; // Added this so your rice meals don't look like hot coffee!

// Specific item images (.jpg based on your folder)
import chocoJavaFrappe from "../assets/Choco Java Chip Frappe.jpg";
import blueberrySoda from "../assets/Blueberry Soda.jpg";

const items = [
  { name: "Cloud Americano", tagLeft: "Iced Coffee", tagRight: "₱120", img: coffee },
  { name: "Choco Java Chip Frappe", tagLeft: "Frappuccino", tagRight: "₱170", img: chocoJavaFrappe },
  { name: "Chicken Cordon Bleu", tagLeft: "Rice Meal", tagRight: "₱180", img: rice },
  { name: "Spanish Latte", tagLeft: "Hot Coffee", tagRight: "₱120", img: hot },
  { name: "Blueberry Soda", tagLeft: "Non-Caff", tagRight: "₱90", img: blueberrySoda },
  { name: "Chicken Alfredo Pasta", tagLeft: "Pasta", tagRight: "₱190", img: sandwiches },
  { name: "Iced Cocoa Tiramisu", tagLeft: "Iced Coffee", tagRight: "₱160", img: coffee },
  { name: "Burger Steak", tagLeft: "Rice Meal", tagRight: "₱160", img: rice },
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveCategoryId(tagLeft, categories) {
  const tag = normalizeText(tagLeft);
  if (!tag) return "";

  const needles = [];
  if (tag.includes("frap")) needles.push("frapp");
  if (tag.includes("rice")) needles.push("rice");
  if (tag.includes("hot")) needles.push("hot coffee");
  if (tag.includes("iced")) needles.push("iced coffee");
  if (tag.includes("non")) needles.push("non");
  if (tag.includes("pasta") || tag.includes("sandwich")) needles.push("pasta");
  needles.push(tag);

  for (const needle of needles) {
    const match = (Array.isArray(categories) ? categories : []).find((cat) => normalizeText(cat?.name).includes(needle));
    if (match?.id) return String(match.id);
  }

  return "";
}

export default function MenuBelt() {
  const navigate = useNavigate();
  const [menuCategories, setMenuCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const categories = await getMenuCategories();
        if (!cancelled) setMenuCategories(Array.isArray(categories) ? categories : []);
      } catch {
        if (!cancelled) setMenuCategories([]);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Duplicate items so the loop looks continuous
  const beltItems = useMemo(() => [...items, ...items], []);

  const handlePick = (picked) => {
    const categoryId = resolveCategoryId(picked?.tagLeft, menuCategories);
    if (!categoryId) {
      navigate("/order");
      return;
    }

    const params = new URLSearchParams();
    if (picked?.name) params.set("focus", String(picked.name));
    const qs = params.toString();

    navigate(`/order/${categoryId}${qs ? `?${qs}` : ""}`);
  };

  return (
    <section className="belt-section">
      <h2 className="belt-title">Cafe Favorites</h2>
      <p className="belt-subtitle">Quick picks from our menu — scroll & discover your next order.</p>

      <div className="belt-viewport">
        <div className="belt-track">
          {beltItems.map((it, idx) => (
            <button
              type="button"
              className="belt-card"
              key={`${it.name}-${idx}`}
              onClick={() => handlePick(it)}
              aria-label={`View ${it.name}`}
            >
              <div className="belt-imgWrap">
                <img src={it.img} alt={it.name} className="belt-img" />
              </div>

              <h3 className="belt-name">{it.name}</h3>

              <div className="belt-tags">
                <span className="tag-category">{it.tagLeft}</span>
                <span className="tag-price">{it.tagRight}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="belt-ctaRow">
        <Link className="belt-ctaBtn" to="/order">
          Order Now
        </Link>
      </div>
    </section>
  );
}
