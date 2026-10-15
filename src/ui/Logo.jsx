/** Brand mark: a chunky football with laces. Same art as public/icon.svg. */
export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#16181d" />
      <ellipse cx="32" cy="32" rx="22" ry="13.5" transform="rotate(-35 32 32)" fill="#a0522d" stroke="#ffd400" strokeWidth="3" />
      <g transform="rotate(-35 32 32)" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
        <line x1="23" y1="32" x2="41" y2="32" />
        <line x1="26" y1="28.5" x2="26" y2="35.5" />
        <line x1="30" y1="28.5" x2="30" y2="35.5" />
        <line x1="34" y1="28.5" x2="34" y2="35.5" />
        <line x1="38" y1="28.5" x2="38" y2="35.5" />
      </g>
    </svg>
  )
}
