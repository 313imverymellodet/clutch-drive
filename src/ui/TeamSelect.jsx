import { NFL_TEAMS } from '../data/nflTeams'
import { TeamLogo } from '../game/real'

export function TeamSelect({ label, value, onChange }) {
  return (
    <label className="team-select">
      <span>{label}</span>
      <span className="ts-row">
        <TeamLogo abbr={value} size={28} />
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {NFL_TEAMS.map((t) => (
            <option key={t.abbr} value={t.abbr}>{t.city} {t.name}</option>
          ))}
        </select>
      </span>
    </label>
  )
}
