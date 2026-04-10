import React from 'react';
import { useLocation } from 'react-router-dom';

// The ".." steps out of the components folder, then goes into the assets folder!
import logoImg from '../assets/husky-logo.jpg'; 

const Footer = () => {
  // This checks what page the user is currently looking at
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>
      
      {/* --- HOME PAGE SECTION: White background --- */}
      {isHome && (
        <div style={{ backgroundColor: '#ffffff', paddingTop: '60px', paddingBottom: '25px', color: '#333333' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 20px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            
            {/* Column 1: Brand */}
            <div style={{ flex: '1', minWidth: '250px', marginBottom: '30px' }}>
              
              {/* --- Replaced Text with Image Logo --- */}
              <img 
                src={logoImg} 
                alt="Happy Tails Logo" 
                style={{ maxWidth: '160px', marginBottom: '10px' }} 
              />
              
              <p style={{ fontSize: '14px', margin: 0, color: '#333333' }}>
                Your pet's paradise since 2015
              </p>
            </div>

            {/* Column 2: Operating Hours */}
            <div style={{ flex: '1', minWidth: '250px', marginBottom: '30px' }}>
              <h3 style={{ color: '#000000', fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: '5px' }}>
                Operating Hours
              </h3>
              <p style={{ fontSize: '14px', margin: '0 0 12px 0', color: '#333333' }}>
                Monday - Friday: 8:00 AM - 7:30 PM
              </p>
              <p style={{ fontSize: '14px', margin: 0, color: '#333333' }}>
                Saturday - Sunday: 8:00 AM - 8:00 PM
              </p>
            </div>

            {/* Column 3: Contact Us */}
            <div style={{ flex: '1.2', minWidth: '320px', marginBottom: '30px' }}>
              <h3 style={{ color: '#000000', fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: '5px' }}>
                Contact Us
              </h3>
              <p style={{ fontSize: '14px', margin: '0 0 12px 0', color: '#333333' }}>FB: Happy Tails Pet Cafe - Lucena</p>
              <p style={{ fontSize: '14px', margin: '0 0 12px 0', color: '#333333' }}>IG: @happytailspetcafelc</p>
              <p style={{ fontSize: '14px', margin: '0 0 12px 0', color: '#333333' }}>Phone: 0917 520 9713</p>
              <p style={{ fontSize: '14px', margin: '0 0 18px 0', color: '#333333' }}>Email: happytailspetcafe@gmail.com</p>
              
              {/* Address with exact line break from the image */}
              <p style={{ fontSize: '13px', margin: 0, color: '#333333', lineHeight: '1.6' }}>
                AMCJ Commercial Building, Bonifacio Drive, Pleasantville<br />
                Subdivision, Phase 1, Ilayang Iyam, Lucena, Philippines, 4301
              </p>
            </div>
          </div>

          {/* Divider Line and Copyright inside the section */}
          <div style={{ maxWidth: '1100px', margin: '40px auto 0', padding: '0 20px' }}>
            <div style={{ borderTop: '1px solid #eaeaea', width: '100%', marginBottom: '25px' }}></div>
            
          </div>
        </div>
      )}

      {/* --- BOTTOM SECTION: Shows on ALL Pages --- */}
      <div style={{ backgroundColor: '#ffffff', padding: '35px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: '17px', color: '#6c757d', margin: '0 0 12px 0' }}>
          © 2026 HappyTails. All rights reserved.
        </p>
        <p style={{ fontSize: '17px', color: '#6c757d', margin: 0 }}>
          Pet Shop, Grooming & Cafe Services
        </p>
      </div>

    </div>
  );
};

export default Footer;