// NBA team names and approximate uniform colors, simplified for the chibi model. Names and colors only;
// logos come from src/game/real.jsx in builds where real branding is on. Fan-made, not affiliated with the NBA.
//
// jersey/shorts/trim map onto the hoops model's material slots; num = jersey number color,
// paint = key (lane) color on the home court, wood = floor tint.

const T = (abbr, city, name, jersey, trim, num, paint = jersey, wood = '#d9a768') => ({ abbr, city, name, jersey, trim, num, paint, wood })

export const NBA_TEAMS = [
  T('ATL', 'Atlanta', 'Hawks', '#C8102E', '#FDB927', '#FFFFFF'),
  T('BOS', 'Boston', 'Celtics', '#007A33', '#FFFFFF', '#FFFFFF', '#007A33', '#d39a5a'),
  T('BKN', 'Brooklyn', 'Nets', '#1A1A1A', '#FFFFFF', '#FFFFFF', '#2b2b2b', '#c9c3bb'),
  T('CHA', 'Charlotte', 'Hornets', '#1D1160', '#00788C', '#FFFFFF', '#00788C'),
  T('CHI', 'Chicago', 'Bulls', '#CE1141', '#1A1A1A', '#FFFFFF'),
  T('CLE', 'Cleveland', 'Cavaliers', '#860038', '#FDBB30', '#FFFFFF'),
  T('DAL', 'Dallas', 'Mavericks', '#00538C', '#B8C4CA', '#FFFFFF'),
  T('DEN', 'Denver', 'Nuggets', '#0E2240', '#FEC524', '#FEC524'),
  T('DET', 'Detroit', 'Pistons', '#1D428A', '#C8102E', '#FFFFFF'),
  T('GSW', 'Golden State', 'Warriors', '#1D428A', '#FFC72C', '#FFC72C'),
  T('HOU', 'Houston', 'Rockets', '#CE1141', '#1A1A1A', '#FFFFFF'),
  T('IND', 'Indiana', 'Pacers', '#002D62', '#FDBB30', '#FDBB30'),
  T('LAC', 'LA', 'Clippers', '#1D428A', '#C8102E', '#FFFFFF'),
  T('LAL', 'Los Angeles', 'Lakers', '#FDB927', '#552583', '#552583', '#552583'),
  T('MEM', 'Memphis', 'Grizzlies', '#5D76A9', '#12173F', '#FFFFFF'),
  T('MIA', 'Miami', 'Heat', '#98002E', '#F9A01B', '#FFFFFF', '#98002E'),
  T('MIL', 'Milwaukee', 'Bucks', '#00471B', '#EEE1C6', '#EEE1C6'),
  T('MIN', 'Minnesota', 'Timberwolves', '#0C2340', '#78BE20', '#FFFFFF', '#236192'),
  T('NOP', 'New Orleans', 'Pelicans', '#0C2340', '#C8102E', '#FFFFFF'),
  T('NYK', 'New York', 'Knicks', '#006BB6', '#F58426', '#FFFFFF'),
  T('OKC', 'Oklahoma City', 'Thunder', '#007AC1', '#EF3B24', '#FFFFFF'),
  T('ORL', 'Orlando', 'Magic', '#0077C0', '#1A1A1A', '#FFFFFF'),
  T('PHI', 'Philadelphia', '76ers', '#006BB6', '#ED174C', '#FFFFFF'),
  T('PHX', 'Phoenix', 'Suns', '#1D1160', '#E56020', '#FFFFFF', '#E56020'),
  T('POR', 'Portland', 'Trail Blazers', '#E03A3E', '#1A1A1A', '#FFFFFF'),
  T('SAC', 'Sacramento', 'Kings', '#5A2D81', '#63727A', '#FFFFFF'),
  T('SAS', 'San Antonio', 'Spurs', '#1A1A1A', '#C4CED4', '#FFFFFF', '#3a3a3a'),
  T('TOR', 'Toronto', 'Raptors', '#CE1141', '#1A1A1A', '#FFFFFF'),
  T('UTA', 'Utah', 'Jazz', '#002B5C', '#F9A01B', '#FFFFFF'),
  T('WAS', 'Washington', 'Wizards', '#002B5C', '#E31837', '#FFFFFF'),
]

export const NBA_BY_ABBR = Object.fromEntries(NBA_TEAMS.map((t) => [t.abbr, t]))

const HAIR = ['#1c1410', '#2b1d14', '#3b2a1e', '#120d0b', '#5a3a22', '#8a5a2b']

/** Colors for the hoops model's recolorable material slots. Away teams wear white with team-color trim. */
export function hoopsUniform(team, { away = false, hair = 0 } = {}) {
  const light = isLight(team.jersey)
  return {
    Jersey: away ? '#f4f4f4' : team.jersey,
    Pants: away ? '#f4f4f4' : team.jersey,
    Stripe: away ? team.jersey : team.trim,
    Socks: '#ffffff',
    Shoe: away ? team.jersey : light ? '#1a1a1a' : team.trim,
    Hair: HAIR[hair % HAIR.length],
  }
}

/** Number color/outline for the decal on a jersey (works for home colors and away whites). */
export function numberStyle(team, away) {
  return away ? { num: team.jersey, jersey: '#f4f4f4', stripe: team.trim } : { num: team.num, jersey: team.jersey, stripe: team.trim }
}

export function isLight(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}
