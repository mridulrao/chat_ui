// src/pages/CanvasPage.jsx
import React, { useRef, useState } from 'react';
import ChatCanvas from '../chatcanvas/ChatCanvas.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { useNavigate } from 'react-router-dom';

export default function CanvasPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef(null);

  return (
    <div className="relative w-full h-full">
      {/* Top-right quick actions circle with stateful hover menu (with grace period) */}
      <div className="fixed top-4 right-4 z-50">
        <div
          className="relative"
          onMouseEnter={() => {
            if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
            setMenuOpen(true);
          }}
          onMouseLeave={() => {
            if (closeTimer.current) clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(() => setMenuOpen(false), 200);
          }}
        >
          <button
            aria-label="Open quick actions"
            className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            •••
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white/95 backdrop-blur border border-white/60 rounded-xl shadow-lg overflow-hidden">
              <div className="py-2">
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                  onClick={() => navigate('/memories')}
                >
                  Past memories
                </button>
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                  onClick={() => {
                    window.dispatchEvent(new Event('chatcanvas:clear'));
                    setMenuOpen(false);
                  }}
                >
                  New conversation
                </button>
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                  onClick={() => navigate('/auth')}
                >
                  Configure{user?.email ? ` (${user.email})` : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <ChatCanvas />
    </div>
  );
}
