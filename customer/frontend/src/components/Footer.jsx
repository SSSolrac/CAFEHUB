import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import logoImg from "../assets/husky-logo.jpg";
import { DEFAULT_PUBLIC_BUSINESS_SETTINGS, getPublicBusinessSettings } from "../services/businessSettingsService";

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

const Footer = () => {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [businessSettings, setBusinessSettings] = useState(DEFAULT_PUBLIC_BUSINESS_SETTINGS);

  useEffect(() => {
    let cancelled = false;

    const loadBusinessSettings = async () => {
      try {
        const settings = await getPublicBusinessSettings();
        if (!cancelled) setBusinessSettings(settings);
      } catch {
        if (!cancelled) setBusinessSettings(DEFAULT_PUBLIC_BUSINESS_SETTINGS);
      }
    };

    loadBusinessSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const hoursLines = useMemo(() => {
    const lines = splitLines(businessSettings.businessHours);
    return lines.length ? lines : splitLines(DEFAULT_PUBLIC_BUSINESS_SETTINGS.businessHours);
  }, [businessSettings.businessHours]);

  const addressLines = useMemo(() => {
    const lines = splitLines(businessSettings.cafeAddress);
    return lines.length ? lines : splitLines(DEFAULT_PUBLIC_BUSINESS_SETTINGS.cafeAddress);
  }, [businessSettings.cafeAddress]);

  const logoSrc = businessSettings.logoUrl || logoImg;

  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>
      {isHome && (
        <div style={{ backgroundColor: "#ffffff", paddingTop: "60px", paddingBottom: "25px", color: "#333333" }}>
          <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 20px", display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ flex: "1", minWidth: "250px", marginBottom: "30px" }}>
              <img src={logoSrc} alt={`${businessSettings.cafeName || "Cafe"} Logo`} style={{ maxWidth: "160px", marginBottom: "10px" }} />
              <p style={{ fontSize: "14px", margin: 0, color: "#333333" }}>{businessSettings.cafeName || DEFAULT_PUBLIC_BUSINESS_SETTINGS.cafeName}</p>
            </div>

            <div style={{ flex: "1", minWidth: "250px", marginBottom: "30px" }}>
              <h3 style={{ color: "#000000", fontSize: "18px", fontWeight: "600", marginBottom: "20px", marginTop: "5px" }}>Operating Hours</h3>
              {hoursLines.map((line, index) => (
                <p key={`hours-${index}`} style={{ fontSize: "14px", margin: index === hoursLines.length - 1 ? 0 : "0 0 12px 0", color: "#333333" }}>
                  {line}
                </p>
              ))}
            </div>

            <div style={{ flex: "1.2", minWidth: "320px", marginBottom: "30px" }}>
              <h3 style={{ color: "#000000", fontSize: "18px", fontWeight: "600", marginBottom: "20px", marginTop: "5px" }}>Contact Us</h3>
              <p style={{ fontSize: "14px", margin: "0 0 12px 0", color: "#333333" }}>FB: {businessSettings.facebookHandle || DEFAULT_PUBLIC_BUSINESS_SETTINGS.facebookHandle}</p>
              <p style={{ fontSize: "14px", margin: "0 0 12px 0", color: "#333333" }}>IG: {businessSettings.instagramHandle || DEFAULT_PUBLIC_BUSINESS_SETTINGS.instagramHandle}</p>
              <p style={{ fontSize: "14px", margin: "0 0 12px 0", color: "#333333" }}>Phone: {businessSettings.contactNumber || DEFAULT_PUBLIC_BUSINESS_SETTINGS.contactNumber}</p>
              <p style={{ fontSize: "14px", margin: "0 0 18px 0", color: "#333333" }}>Email: {businessSettings.businessEmail || DEFAULT_PUBLIC_BUSINESS_SETTINGS.businessEmail}</p>

              <p style={{ fontSize: "13px", margin: 0, color: "#333333", lineHeight: "1.6" }}>
                {addressLines.map((line, index) => (
                  <React.Fragment key={`address-${index}`}>
                    {line}
                    {index < addressLines.length - 1 ? <br /> : null}
                  </React.Fragment>
                ))}
              </p>
            </div>
          </div>

          <div style={{ maxWidth: "1100px", margin: "40px auto 0", padding: "0 20px" }}>
            <div style={{ borderTop: "1px solid #eaeaea", width: "100%", marginBottom: "25px" }} />
          </div>
        </div>
      )}

      <div style={{ backgroundColor: "#ffffff", padding: "35px 20px", textAlign: "center" }}>
        <p style={{ fontSize: "17px", color: "#6c757d", margin: "0 0 12px 0" }}>(c) 2026 HappyTails. All rights reserved.</p>
        <p style={{ fontSize: "17px", color: "#6c757d", margin: 0 }}>Pet Shop, Grooming & Cafe Services</p>
      </div>
    </div>
  );
};

export default Footer;

