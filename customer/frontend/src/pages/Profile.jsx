import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import LoyaltyCard from "../components/loyalty/LoyaltyCard";
import { getCustomerLoyaltyData, redeemLoyaltyReward } from "../services/loyaltyService";
import { getCustomerProfile, saveCustomerProfile } from "../services/profileService";
import { useAuth } from "../context/AuthContext";
import "./Profile.css";

const blankProfile = {
  name: "",
  phone: "",
  email: "",
  addresses: [],
  preferences: {}
};

function Profile({ linkComponent: LinkComponent }) {
  const { user, session } = useAuth();
  const [formData, setFormData] = useState(blankProfile);
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [redeemingRewardId, setRedeemingRewardId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});

  const loadLoyaltyData = async () => {
    const data = await getCustomerLoyaltyData();
    setLoyaltyData(data);
  };

  useEffect(() => {
    const loadProfile = async () => {
      setIsLoading(true);
      setError("");
      try {
        const profile = await getCustomerProfile();
        const mergedProfile = {
          ...blankProfile,
          email: user?.email || "",
          ...profile
        };
        setFormData(mergedProfile);
        await loadLoyaltyData();
      } catch (loadError) {
        setError(loadError?.message || "We couldn't load your account details right now.");
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user?.email]);

  const handleChange = (event) => {
    setFormData({ ...formData, [event.target.name]: event.target.value });
    setErrors((prev) => ({ ...prev, [event.target.name]: "" }));
    setMessage("");
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!formData.name.trim()) nextErrors.name = "Name is required.";
    if (!/^\+?[0-9\-\s]{7,15}$/.test(formData.phone.trim())) nextErrors.phone = "Enter a valid phone number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) nextErrors.email = "Enter a valid email address.";

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await saveCustomerProfile(formData);
      setMessage("Profile saved. Checkout will use your latest details automatically.");
      await loadLoyaltyData();
    } catch (saveError) {
      setError(saveError?.message || "Unable to save right now. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRedeemReward = async (reward) => {
    const rewardId = String(reward?.id || "").trim();
    if (!rewardId) return;

    setError("");
    setMessage("");
    setRedeemingRewardId(rewardId);

    try {
      await redeemLoyaltyReward(rewardId);
      await loadLoyaltyData();
      setMessage(`${reward?.label || "Reward"} redeemed successfully.`);
    } catch (redeemError) {
      setError(redeemError?.message || "Unable to redeem reward right now.");
    } finally {
      setRedeemingRewardId("");
    }
  };

  if (isLoading) {
    return <div className="loyalty-loading">Loading your profile...</div>;
  }

  const LinkImpl = LinkComponent || RouterLink;

  return (
      <div className="profile-page">
      <h1>My Profile</h1>
      <p className="profile-session">Signed in as <strong>{user?.email || session?.user?.email}</strong></p>

      {error ? <p className="field-error profile-top-error">{error}</p> : null}

      {loyaltyData ? (
        <LoyaltyCard loyaltyData={loyaltyData} onRedeemReward={handleRedeemReward} redeemingRewardId={redeemingRewardId} />
      ) : (
        <p className="loyalty-loading">Loading loyalty card...</p>
      )}

      <div className="profile-links">
        <LinkImpl href="/order-history" to="/order-history">View order history</LinkImpl>
        <LinkImpl href="/track-order" to="/track-order">Track latest order</LinkImpl>
      </div>

      <form className="profile-form" onSubmit={handleSave}>
        <input type="text" name="name" placeholder="Full Name" value={formData.name} onChange={handleChange} />
        {errors.name ? <p className="field-error">{errors.name}</p> : null}

        <input type="email" name="email" placeholder="Email" value={formData.email} onChange={handleChange} />
        {errors.email ? <p className="field-error">{errors.email}</p> : null}

        <input type="text" name="phone" placeholder="Phone Number" value={formData.phone} onChange={handleChange} />
        {errors.phone ? <p className="field-error">{errors.phone}</p> : null}

        <input
          type="text"
          name="addresses"
          placeholder="Primary Address"
          value={Array.isArray(formData.addresses) ? (formData.addresses[0] || "") : ""}
          onChange={(event) => handleChange({ target: { name: "addresses", value: [event.target.value] } })}
        />

        <button type="submit" className="save-btn" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Information"}
        </button>

        {message ? <p className="profile-message">{message}</p> : null}
      </form>
    </div>
  );
}

export default Profile;
