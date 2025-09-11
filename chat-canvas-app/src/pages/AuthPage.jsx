// src/pages/AuthPage.jsx
import React, { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AuthPage() {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/canvas';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'signin') {
        await signInWithEmail({ email, password });
        navigate(from, { replace: true });
      } else {
        const { session, user } = await signUpWithEmail({ email, password });
        if (session) {
          navigate('/canvas', { replace: true });
        } else {
          setInfo('Sign up successful. Please check your email to confirm your account.');
        }
      }
    } catch (err) {
      setError(err?.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-md bg-white/80 backdrop-blur rounded-2xl shadow-xl border border-white/60 p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</div>
          )}
          {info && (
            <div className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-md p-2">{info}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-4 text-sm text-gray-600 text-center">
          {mode === 'signin' ? (
            <span>
              Don't have an account?{' '}
              <button className="text-blue-600 hover:underline" onClick={() => setMode('signup')}>Sign up</button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button className="text-blue-600 hover:underline" onClick={() => setMode('signin')}>Sign in</button>
            </span>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link to="/canvas" className="text-xs text-gray-400 hover:text-gray-600">
            Continue without signing in (will be redirected if required)
          </Link>
        </div>
      </div>
    </div>
  );
}
