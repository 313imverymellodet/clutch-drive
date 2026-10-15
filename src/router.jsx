import { useEffect, useState } from 'react'

// Tiny history router: "/", "/play", "/locker". Vercel rewrites every path to index.html.
export function navigate(to) {
  if (to === location.pathname + location.search) return
  history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function useRoute() {
  const read = () => ({ path: location.pathname.replace(/\/+$/, '') || '/', query: new URLSearchParams(location.search) })
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return route
}

export function Link({ to, children, ...props }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...props}
    >
      {children}
    </a>
  )
}
