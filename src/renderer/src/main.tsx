import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Test hook for scripts/e2e.mjs (never exposed in normal runs).
if (window.meowFiles?.e2e) {
  void Promise.all([import('./lib/actions'), import('./lib/store'), import('./lib/exporting'), import('./engine/pool')]).then(
    ([actions, store, exporting, pool]) => {
      window.__meow = { actions, store, exporting, pool }
    }
  )
}
