import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import RequiredUpdateGate from './components/RequiredUpdateGate';
import StorePromo from './components/StorePromo';
import './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <RequiredUpdateGate packageName="com.quarc.weather" />
      <StorePromo dialog />
    </BrowserRouter>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  if (window.location.hostname === 'tauri.localhost') {
    // The Windows app has its own copy of the page: no worker (see public/sw.js), and remove one an older version left.
    navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => r.unregister())).catch(() => {});
    window.caches?.keys().then((keys) => keys.forEach((k) => window.caches.delete(k))).catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}
