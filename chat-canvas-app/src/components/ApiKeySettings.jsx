// src/components/ApiKeySettings.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ApiKeySettings() {
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState({ hasKey: false, last4: '', createdAt: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const navigate = useNavigate();

  async function refreshStatus() {
    try {
      const res = await fetch('/api/key/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to get status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function save() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key.trim(), remember }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setKey('');
      await refreshStatus();
      // Redirect to canvas after successful save
      navigate('/canvas', { replace: true });
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  async function clearKey() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/key', { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to clear');
      await refreshStatus();
    } catch (e) {
      setError(e?.message || 'Failed to clear');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">OpenAI API key</h2>
        <div className="relative">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-700"
            onClick={() => setInfoOpen((v) => !v)}
            aria-label="How we store your key"
            title="How we store your key"
          >
            ℹ️
          </button>
          {infoOpen && (
            <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 shadow-lg">
              <p className="mb-2">
                We never send your key to other users or the client after saving. If you provide a key, it is encrypted on the
                server using a sealed cookie (<code>HttpOnly</code>, <code>Secure</code>, <code>SameSite=Lax</code>) with a short lifetime by default.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your browser never sees the raw key again after submission.</li>
                <li>No logs or analytics capture the key.</li>
                <li>Click “Remember on this device” to extend the cookie lifetime.</li>
                <li>You can remove the key at any time with “Delete key”.</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white/70 p-4">
        {status?.hasKey ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Using your key ending in <span className="font-mono font-semibold">…{status.last4}</span>
              {status.createdAt && (
                <span className="text-gray-500"> (set {new Date(status.createdAt).toLocaleString()})</span>
              )}
            </div>
            <button
              onClick={clearKey}
              disabled={loading}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Delete key
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enter your OpenAI API key</label>
              <input
                type="password"
                placeholder="sk-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded"
              />
              Remember on this device
            </label>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</div>}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={loading || !key}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Save key
              </button>
              <a
                className="text-sm text-blue-700 hover:underline self-center"
                href="https://platform.openai.com/api-keys"
                target="_blank" rel="noreferrer"
              >
                Get an API key ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
