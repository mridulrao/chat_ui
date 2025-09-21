import './index.css';

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from './pages/AuthPage.jsx';
import CanvasPage from './pages/CanvasPage.jsx';
import MemoriesPage from './pages/MemoriesPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/memories" element={<MemoriesPage />} />
      <Route path="/canvas" element={<CanvasPage />} />
      <Route path="/" element={<Navigate to="/canvas" replace />} />
      <Route path="*" element={<Navigate to="/canvas" replace />} />
    </Routes>
  );
}

export default App;