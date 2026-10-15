// NFL team names and approximate uniform colors (home look), simplified for the chibi model.
// Names/colors only; no logos. Fan-made, not affiliated with the NFL.
//
// jersey/helmet/stripe/pants/socks map onto the Blender material slots.
// num = jersey number color, endzone = end zone paint, text = end zone lettering.

const T = (abbr, city, name, jersey, helmet, stripe, pants, socks, num, endzone = jersey, text = num) => ({
  abbr, city, name, jersey, helmet, stripe, pants, socks, num, endzone, text,
})

export const NFL_TEAMS = [
  T('ARI', 'Arizona', 'Cardinals', '#97233F', '#FFFFFF', '#000000', '#FFFFFF', '#97233F', '#FFFFFF'),
  T('ATL', 'Atlanta', 'Falcons', '#1D1D1D', '#101820', '#A71930', '#FFFFFF', '#1D1D1D', '#FFFFFF', '#A71930', '#FFFFFF'),
  T('BAL', 'Baltimore', 'Ravens', '#241773', '#101820', '#9E7C0C', '#FFFFFF', '#241773', '#FFFFFF'),
  T('BUF', 'Buffalo', 'Bills', '#00338D', '#FFFFFF', '#C60C30', '#FFFFFF', '#00338D', '#FFFFFF'),
  T('CAR', 'Carolina', 'Panthers', '#101820', '#A5ACAF', '#0085CA', '#A5ACAF', '#0085CA', '#0085CA', '#0085CA', '#FFFFFF'),
  T('CHI', 'Chicago', 'Bears', '#0B162A', '#0B162A', '#C83803', '#FFFFFF', '#0B162A', '#FFFFFF', '#0B162A', '#C83803'),
  T('CIN', 'Cincinnati', 'Bengals', '#1A1A1A', '#FB4F14', '#1A1A1A', '#FFFFFF', '#FB4F14', '#FFFFFF', '#FB4F14', '#1A1A1A'),
  T('CLE', 'Cleveland', 'Browns', '#311D00', '#FF3C00', '#FFFFFF', '#FFFFFF', '#FF3C00', '#FF3C00', '#FF3C00', '#311D00'),
  T('DAL', 'Dallas', 'Cowboys', '#FFFFFF', '#869397', '#003594', '#869397', '#003594', '#003594', '#003594', '#FFFFFF'),
  T('DEN', 'Denver', 'Broncos', '#FB4F14', '#002244', '#FB4F14', '#FFFFFF', '#002244', '#002244'),
  T('DET', 'Detroit', 'Lions', '#0076B6', '#B0B7BC', '#0076B6', '#B0B7BC', '#0076B6', '#FFFFFF'),
  T('GB', 'Green Bay', 'Packers', '#203731', '#FFB612', '#203731', '#FFB612', '#203731', '#FFFFFF', '#203731', '#FFB612'),
  T('HOU', 'Houston', 'Texans', '#03202F', '#03202F', '#A71930', '#FFFFFF', '#03202F', '#FFFFFF', '#03202F', '#A71930'),
  T('IND', 'Indianapolis', 'Colts', '#002C5F', '#FFFFFF', '#002C5F', '#FFFFFF', '#002C5F', '#FFFFFF'),
  T('JAX', 'Jacksonville', 'Jaguars', '#006778', '#101820', '#D7A22A', '#FFFFFF', '#006778', '#FFFFFF', '#006778', '#D7A22A'),
  T('KC', 'Kansas City', 'Chiefs', '#E31837', '#E31837', '#FFFFFF', '#FFFFFF', '#E31837', '#FFFFFF', '#E31837', '#FFB81C'),
  T('LV', 'Las Vegas', 'Raiders', '#101820', '#A5ACAF', '#101820', '#A5ACAF', '#101820', '#FFFFFF', '#101820', '#A5ACAF'),
  T('LAC', 'Los Angeles', 'Chargers', '#0080C6', '#0080C6', '#FFC20E', '#FFFFFF', '#0080C6', '#FFFFFF', '#0080C6', '#FFC20E'),
  T('LAR', 'Los Angeles', 'Rams', '#003594', '#003594', '#FFA300', '#FFD100', '#003594', '#FFD100'),
  T('MIA', 'Miami', 'Dolphins', '#008E97', '#FFFFFF', '#008E97', '#FFFFFF', '#008E97', '#FFFFFF', '#008E97', '#FC4C02'),
  T('MIN', 'Minnesota', 'Vikings', '#4F2683', '#4F2683', '#FFC62F', '#FFFFFF', '#4F2683', '#FFFFFF', '#4F2683', '#FFC62F'),
  T('NE', 'New England', 'Patriots', '#002244', '#B0B7BC', '#C60C30', '#FFFFFF', '#002244', '#FFFFFF', '#002244', '#C60C30'),
  T('NO', 'New Orleans', 'Saints', '#101820', '#D3BC8D', '#101820', '#D3BC8D', '#101820', '#D3BC8D'),
  T('NYG', 'New York', 'Giants', '#0B2265', '#0B2265', '#A71930', '#A5ACAF', '#A71930', '#FFFFFF', '#0B2265', '#A71930'),
  T('NYJ', 'New York', 'Jets', '#125740', '#125740', '#FFFFFF', '#FFFFFF', '#125740', '#FFFFFF'),
  T('PHI', 'Philadelphia', 'Eagles', '#004C54', '#004C54', '#A5ACAF', '#FFFFFF', '#004C54', '#FFFFFF', '#004C54', '#A5ACAF'),
  T('PIT', 'Pittsburgh', 'Steelers', '#101820', '#101820', '#FFB612', '#FFB612', '#101820', '#FFB612'),
  T('SF', 'San Francisco', '49ers', '#AA0000', '#B3995D', '#AA0000', '#B3995D', '#AA0000', '#FFFFFF', '#AA0000', '#B3995D'),
  T('SEA', 'Seattle', 'Seahawks', '#002244', '#002244', '#69BE28', '#FFFFFF', '#002244', '#FFFFFF', '#002244', '#69BE28'),
  T('TB', 'Tampa Bay', 'Buccaneers', '#D50A0A', '#34302B', '#D50A0A', '#34302B', '#D50A0A', '#FFFFFF', '#D50A0A', '#34302B'),
  T('TEN', 'Tennessee', 'Titans', '#0C2340', '#0C2340', '#4B92DB', '#FFFFFF', '#0C2340', '#FFFFFF', '#0C2340', '#4B92DB'),
  T('WAS', 'Washington', 'Commanders', '#5A1414', '#5A1414', '#FFB612', '#FFB612', '#5A1414', '#FFB612'),
]

export const TEAM_BY_ABBR = Object.fromEntries(NFL_TEAMS.map((t) => [t.abbr, t]))

/** Colors for the character's recolorable material slots. */
export function uniformOf(team) {
  return {
    Jersey: team.jersey,
    Helmet: team.helmet,
    Stripe: team.stripe,
    Pants: team.pants,
    Socks: team.socks,
    Glove: team.jersey === '#FFFFFF' ? team.stripe : team.jersey,
  }
}

/** Is a hex color light? Used to pick contrasting outlines. */
export function isLight(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 170
}
