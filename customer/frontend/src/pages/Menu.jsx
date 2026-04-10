import { Link } from "react-router-dom";
import menu1 from "../assets/menu1.JPG";
import menu2 from "../assets/menu2.JPG";
import MenuOfTheDay from "../components/dailyMenu/MenuOfTheDay";
import { getCurrentDailyMenu, getMenuCatalog } from "../services/dailyMenuService";
import { getMenuCategories } from "../services/menuService";
import { resolveMenuItemImage } from "../utils/menuImages";
import { useEffect, useMemo, useState } from "react";
import "./Menu.css";

function Menu() {
  const [dailyMenu, setDailyMenu] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogItems, setCatalogItems] = useState([]);
  const [menuCategories, setMenuCategories] = useState([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError("");
      try {
        const [data, catalog] = await Promise.all([getCurrentDailyMenu(), getMenuCatalog()]);
        setDailyMenu(data);
        setCatalogItems(catalog);
        const categories = await getMenuCategories().catch(() => []);
        setMenuCategories(categories.filter((category) => category.isActive !== false));
      } catch (loadError) {
        setError(loadError?.message || "Could not load today's featured menu right now.");
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const featuredItems = useMemo(() => {
    const categoryById = new Map(menuCategories.map((category) => [String(category.id || ""), String(category.name || "")]));

    return catalogItems.slice(0, 6).map((item) => {
      const safeName = String(item.name || "").trim() || "Item";
      return {
        id: item.id,
        image: item.imageUrl || resolveMenuItemImage(safeName, categoryById.get(String(item.categoryId || ""))) || menu1,
        name: safeName,
        price: Math.max(Number(item.price || 0) - Number(item.discount || 0), 0),
        discountAmount: Number(item.discount || 0),
        availability: item.isAvailable === false ? "Unavailable" : "Available",
      };
    });
  }, [catalogItems, menuCategories]);

  return (
    <div className="menu-page">
      <h1 className="menu-title">Our Café Menu</h1>

      {isLoading ? <p className="menu-loading">Loading menu of the day...</p> : null}
      {!isLoading && error ? <p className="menu-loading">{error}</p> : null}
      {!isLoading && !error ? <MenuOfTheDay menuData={dailyMenu} /> : null}

      <section className="featured-grid">
        {!featuredItems.length && !isLoading ? <p className="menu-loading">No menu items available right now.</p> : null}
        {featuredItems.map((item) => (
          <article key={item.id} className="featured-card">
            <img src={item.image} alt={item.name} />
            <h3>{item.name}</h3>
            <p>₱{item.price}</p>
            {item.discountAmount ? <p className="menu-discount-tag">₱{item.discountAmount} OFF</p> : null}
            <span className={item.availability === "Available" ? "available" : "sold-out"}>{item.availability}</span>
          </article>
        ))}
      </section>

      <section className="menu-categories">
        {!menuCategories.length && !isLoading ? <p className="menu-loading">No categories available right now.</p> : null}
        {menuCategories.map((category) => (
          <Link key={category.id} to={`/order/${category.id}`} className="category-chip">
            {category.name}
          </Link>
        ))}
      </section>

      <div className="menu-grid">
        <div className="menu-card">
          <img src={menu1} alt="Drinks Menu" />
        </div>
        <div className="menu-card">
          <img src={menu2} alt="Food Menu" />
        </div>
      </div>

      <div className="menu-cta-wrap">
        <Link to="/order" className="menu-cta">Start Your Order</Link>
      </div>
    </div>
  );
}

export default Menu;
