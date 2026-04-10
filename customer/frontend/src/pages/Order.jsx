import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Order.css";

import sandwiches from "../assets/sandwiches.png";
import rice from "../assets/ricemeal.png";
import iced from "../assets/coffee.png";
import hot from "../assets/hot.png";
import noncafe from "../assets/soda.png";
import frappe from "../assets/frappe.png";
import { getMenuCategories } from "../services/menuService";

function getCategoryImage(name) {
  const label = String(name || "").toLowerCase();
  if (label.includes("rice")) return rice;
  if (label.includes("iced")) return iced;
  if (label.includes("hot")) return hot;
  if (label.includes("frap")) return frappe;
  if (label.includes("non") || label.includes("soda")) return noncafe;
  return sandwiches;
}

function Order({ navigateOverride }) {
  const navigate = useNavigate();
  const [remoteCategories, setRemoteCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError("");
      try {
        const categories = await getMenuCategories();
        if (!cancelled) setRemoteCategories(categories);
      } catch (loadError) {
        if (!cancelled) setRemoteCategories([]);
        if (!cancelled) setError(loadError?.message || "Unable to load categories right now.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    return remoteCategories
      .map((category) => ({
        id: String(category.id || ""),
        title: String(category.name || "Category"),
        image: getCategoryImage(category.name),
      }))
      .filter((entry) => entry.id);
  }, [remoteCategories]);

  return (
    <div className="order-page">
      <div className="order-header">
        <h1>Order by Category</h1>
      </div>

      <div className="categories">
        {isLoading ? <p style={{ padding: 24 }}>Loading categories...</p> : null}
        {!isLoading && error ? <p style={{ padding: 24, color: "#a11" }}>{error}</p> : null}
        {!isLoading && !error && !categories.length ? <p style={{ padding: 24 }}>No categories available right now.</p> : null}
        {!isLoading
          ? categories.map((category) => (
            <div
              key={category.id}
              className="category-card"
              onClick={() => (navigateOverride ? navigateOverride(`/order/${category.id}`) : navigate(`/order/${category.id}`))}
              style={{ cursor: "pointer" }}
            >
              <img src={category.image} alt={category.title} />
              <h3>{category.title}</h3>
            </div>
          ))
          : null}

      </div>
    </div>
  );
}

export default Order;
