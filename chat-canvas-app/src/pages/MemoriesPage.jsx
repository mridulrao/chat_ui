// src/pages/MemoriesPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadHistory, saveHistory, setPendingLoad, loadState } from '../chatcanvas/utils/persistence';

export default function MemoriesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    try {
      setItems(loadHistory());
    } catch {}
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => (it?.title || '').toLowerCase().includes(q));
  }, [items, query]);

  // Also show current unsaved session (from local storage state) for convenience
  const currentSession = useMemo(() => {
    try {
      const st = loadState();
      if (st?.messages?.length) {
        const first = [...st.messages].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp))[0];
        return {
          id: 'current-session',
          title: (first?.text || 'Current conversation').slice(0, 80),
          createdAt: first?.timestamp || null,
          updatedAt: null,
          messages: st.messages,
          stageSize: st.stageSize,
        };
      }
    } catch {}
    return null;
  }, []);

  const openMemory = (session) => {
    try {
      setPendingLoad({ messages: session.messages || [], stageSize: session.stageSize || null });
      navigate('/canvas');
    } catch (e) {
      console.warn('[memories] failed to open:', e);
    }
  };

  const deleteMemory = (id) => {
    const next = items.filter((it) => it.id !== id);
    setItems(next);
    saveHistory(next);
  };

  const clearAll = () => {
    setItems([]);
    saveHistory([]);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Past memories</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/canvas')}
              className="px-3 py-1.5 rounded-full border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
            >
              Back to canvas
            </button>
            {items.length > 0 && (
              <button
                onClick={clearAll}
                className="px-3 py-1.5 rounded-full bg-red-600 text-white hover:bg-red-700"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          />
        </div>

        {currentSession && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Current</div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{currentSession.title}</div>
                <div className="text-xs text-gray-500">{currentSession.messages.length} messages</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openMemory(currentSession)}
                  className="px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                >
                  Open
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Saved</div>
        {filtered.length === 0 ? (
          <div className="text-sm text-gray-500">No memories yet. Start a conversation, then use "New conversation" to archive it here.</div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((it) => (
              <li key={it.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{it.title || 'Untitled'}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span>{new Date(it.createdAt || Date.now()).toLocaleString()}</span>
                    <span>•</span>
                    <span>{it.messages?.length || 0} messages</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openMemory(it)}
                    className="px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => deleteMemory(it.id)}
                    className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
