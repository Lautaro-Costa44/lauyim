// Shared by the admin tests that mount the whole App (Members, ImportMembers).
import { act } from 'react'

// The chunks the app loads lazily on the admin paths (route pages and the heavy sheets), loaded
// once up front. Otherwise each test waited on Vite transforming them in the middle of a click,
// which under the full suite's load pushed tests past their timeout.
export const preloadAdminChunks = () => Promise.all([
  import('./AdminLayout.jsx'), import('./Usuarios.jsx'), import('./Cuotas.jsx'),
  import('./members/ImportMembersSheet.jsx'), import('./members/MemberSheets.jsx'),
  import('./billing/MemberBillingSheet.jsx'),
])

// Waits for the UI to settle instead of sleeping a fixed time per action: macrotask turns until
// no lazy route is loading and the DOM did not change for three turns in a row. Debounces with a
// real delay (a search box) still need their own wait before this.
export async function flush() {
  let last = null
  for (let i = 0, stable = 0; i < 2000 && stable < 3; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const html = document.body.innerHTML
    stable = html === last && !document.querySelector('.page-loading') ? stable + 1 : 0
    last = html
  }
}
