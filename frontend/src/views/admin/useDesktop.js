import { useEffect, useState } from 'react'

// Same breakpoint as the desktop block of index.css.
const DESKTOP = '(min-width: 1000px)'

export function useDesktop() {
  const [desktop, setDesktop] = useState(() => !!window.matchMedia?.(DESKTOP).matches)
  useEffect(() => {
    const mql = window.matchMedia?.(DESKTOP)
    if (!mql) return
    const onChange = () => setDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return desktop
}
