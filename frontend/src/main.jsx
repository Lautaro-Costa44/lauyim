import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { createUpdater, installChunkErrorReload, setUpdater } from './lib/update.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { countSync } from './lib/sync-queue.js'
import { api } from './lib/api.js'

// URL pública del aviso de privacidad sin hash (/privacidad): el router usa #/privacidad.
// Nginx y el Service Worker ya redirigen; esto cubre cualquier otro servidor.
if (/\/privacidad\/?$/.test(location.pathname) && !location.hash) {
  history.replaceState(null, '', location.pathname.replace(/privacidad\/?$/, '') + location.search + '#/privacidad')
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Actualizaciones: SW en waiting hasta un momento seguro (lib/update.js). Sin https no hay SW,
// pero el chequeo de versión crítica y la recarga por chunks faltantes funcionan igual.
installChunkErrorReload()
const updater = createUpdater({
  isActive: () => !!useStore.getState().S.active,
  countPending: async () => { const id = useStore.getState().user?.id; return id ? countSync(id) : 0 },
  syncPending: () => useStore.getState().syncPending(),
  sheetsOpen: () => useUI.getState().sheets.length > 0,
  fetchConfig: () => api('/api/config', { timeoutMs: 4000 }),
  version: __APP_VERSION__,
  sw: 'serviceWorker' in navigator && location.protocol === 'https:' ? navigator.serviceWorker : undefined,
})
setUpdater(updater)
updater.start()
