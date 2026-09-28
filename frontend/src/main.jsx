import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// URL pública del aviso de privacidad sin hash (/privacidad): el router usa #/privacidad.
// Nginx y el Service Worker ya redirigen; esto cubre cualquier otro servidor.
if (/\/privacidad\/?$/.test(location.pathname) && !location.hash) {
  history.replaceState(null, '', location.pathname.replace(/privacidad\/?$/, '') + location.search + '#/privacidad')
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
