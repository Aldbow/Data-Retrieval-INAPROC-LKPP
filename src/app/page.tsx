import React from 'react';

export default function Home() {
  return (
    <div style={{ padding: 'var(--spacing-xl)', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Header Section */}
      <header style={{ textAlign: 'center', marginBottom: 'var(--spacing-xl)', paddingTop: '10vh' }}>
        <h1 style={{ fontSize: '3rem', letterSpacing: '-0.02em', marginBottom: 'var(--spacing-sm)' }}>
          System <span style={{ color: 'var(--accent-color)' }}>V2</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto' }}>
          Radically redesigned with premium glassmorphism, ensuring an intuitive and powerful user experience.
        </p>
      </header>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--spacing-lg)' }}>
        
        {/* Card 1 */}
        <div className="glass-card">
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--spacing-md)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <h3>Dashboard Insights</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            Pantau semua metrik kunci secara real-time melalui antarmuka visual yang bersih.
          </p>
          <button className="btn-glass">Lihat Detail</button>
        </div>

        {/* Card 2 */}
        <div className="glass-card">
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--spacing-md)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <line x1="3" x2="21" y1="9" y2="9" />
              <line x1="9" x2="9" y1="21" y2="9" />
            </svg>
          </div>
          <h3>Sinkronisasi Data</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            Didukung oleh pre-deployment tester untuk menjamin validitas endpoint otomatis.
          </p>
          <button className="btn-glass" style={{ borderColor: 'rgba(139, 92, 246, 0.4)', color: '#d8b4fe' }}>Cek Status</button>
        </div>

        {/* Card 3 */}
        <div className="glass-card">
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--spacing-md)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h3>Keamanan Maksimal</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            Sistem yang dirancang tangguh namun sangat ramah untuk pengguna awam.
          </p>
          <button className="btn-glass" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', color: '#6ee7b7' }}>Pengaturan</button>
        </div>

      </div>
    </div>
  );
}
