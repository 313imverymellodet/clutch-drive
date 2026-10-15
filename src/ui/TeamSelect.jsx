import { NFL_TEAMS } from '../data/nflTeams'

export function TeamSelect({ label, value, onChange }) {
  return (
    <label className="team-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {NFL_TEAMS.map((t) => (
          <option key={t.abbr} value={t.abbr}>{t.city} {t.name}</option>
        ))}
      </select>
    </label>
  )
}
