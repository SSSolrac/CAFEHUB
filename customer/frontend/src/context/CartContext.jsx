/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);

const STORAGE_KEY = "happyTailsCafeCart_v1";

export function CartProvider({ children }) {
  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  const addItem = (item) => {
    // item: { id, name, price, image, category }
    setCart((prev) => {
      const existing = prev.find((x) => x.id === item.id);
      if (existing) {
        return prev.map((x) => (x.id === item.id ? { ...x, qty: x.qty + 1 } : x));
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeItem = (id) => {
    setCart((prev) => prev.filter((x) => x.id !== id));
  };

  const changeQty = (id, delta) => {
    setCart((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const nextQty = x.qty + delta;
        return { ...x, qty: Math.max(1, nextQty) };
      })
    );
  };

  const setQty = (id, qty) => {
    const safe = Number.isFinite(qty) ? Math.max(1, qty) : 1;
    setCart((prev) => prev.map((x) => (x.id === id ? { ...x, qty: safe } : x)));
  };

  const clearCart = () => setCart([]);

  const cartCount = useMemo(() => cart.reduce((sum, x) => sum + x.qty, 0), [cart]);

  const total = useMemo(() => cart.reduce((sum, x) => sum + x.price * x.qty, 0), [cart]);

  const value = {
    cart,
    addItem,
    removeItem,
    changeQty,
    setQty,
    clearCart,
    cartCount,
    total,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}