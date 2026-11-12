import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';

// Note: no <React.StrictMode> on purpose. In dev, StrictMode mounts components
// twice, which would open the camera twice. We'll add it back once the
// camera/tracking lifecycle is fully cleanup-safe.
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
