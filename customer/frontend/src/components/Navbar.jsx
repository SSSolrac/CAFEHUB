import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import profileIcon from "../assets/profile.png";
import "./Navbar.css";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { getUnreadNotificationCount, syncCustomerNotifications } from "../services/notificationService";

function Navbar({ onSignOut, onOpenModal }) {
  const { cartCount } = useCart();
  const { isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;

    const loadNotifications = async () => {
      try {
        await syncCustomerNotifications();
      } catch {
        // silent fallback to cached count
      }
      setUnreadCount(getUnreadNotificationCount());
    };

    loadNotifications();
  }, [isAuthenticated]);

  const visibleUnreadCount = isAuthenticated ? unreadCount : 0;

  return (
    <nav className="navbar" style={{ backgroundColor: "#ffffff" }}>
      <div className="nav-left">
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <img src={logo} alt="Logo" className="nav-logo" />
          <span className="logo-text" style={{ marginLeft: "10px", fontSize: "1.5rem", fontWeight: "700", textShadow: "1px 1px 2px rgba(0,0,0,0.1)" }}>
            <span style={{ color: "#ff4d94" }}>Happy</span>
            <span style={{ color: "#36d7e8" }}>Tails</span>
          </span>
        </Link>
      </div>

      <ul className="nav-center" style={{ marginLeft: "auto", marginRight: "40px" }}>
        <li><Link to="/" style={{ color: "#000000" }}>Home</Link></li>
        <li><Link to="/menu" style={{ color: "#000000" }}>Café Menu</Link></li>
        <li><Link to="/about" style={{ color: "#000000" }}>About Us</Link></li>
        {isAuthenticated ? <li><Link to="/order-history" style={{ color: "#000000" }}>My Orders</Link></li> : null}
      </ul>

      <div className="nav-right">
        {isAuthenticated ? (
          <Link to="/notifications" className="cart-link" aria-label="Notifications">
            <span className="basket-icon">🔔</span>
            {visibleUnreadCount > 0 && <span className="cart-badge">{visibleUnreadCount > 99 ? "99+" : visibleUnreadCount}</span>}
          </Link>
        ) : null}

        <Link to="/cart" className="cart-link" aria-label="Basket">
          <span className="basket-icon">🧺</span>
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </Link>

        {isAuthenticated ? (
          <>
            <Link to="/profile" className="profile-link">
              <img src={profileIcon} alt="Profile" className="profile-icon" style={{ filter: "brightness(0)" }} />
            </Link>
            <button className="auth-btn" onClick={onSignOut} style={{ color: "#000000" }}>Sign Out</button>
          </>
        ) : (
          <button className="auth-btn" onClick={onOpenModal} style={{ color: "#000000" }}>Sign Up / Login</button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
