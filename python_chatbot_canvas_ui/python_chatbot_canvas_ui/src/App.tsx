import './index.css';

import { Routes, Route, Navigate } from 'react-router-dom';
import CanvasPage from './pages/CanvasPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/canvas" element={<CanvasPage />} />
      <Route path="/" element={<Navigate to="/canvas" replace />} />
      <Route path="*" element={<Navigate to="/canvas" replace />} />
    </Routes>
  );
}

export default App;