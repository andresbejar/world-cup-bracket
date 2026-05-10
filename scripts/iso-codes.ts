// Canonical ISO 3166-1 alpha-3 codes for the 48 World Cup 2026 teams.
//
// Why this exists: api-sports.io's `team.code` field is unreliable
// (verified APT-1, 2026-05-09):
//   - AUS = Australia AND Austria (collision)
//   - IRA = Iran AND Iraq (collision)
//   - JAP = Japan (FIFA standard is JPN)
//   - NET = Netherlands (FIFA standard is NED)
//   - CAP = Cape Verde (FIFA standard is CPV)
//   - ZEA = New Zealand (FIFA standard is NZL)
//   - Curaçao has no code at all (null)
//
// Map is keyed by api-sports `team.id` (stable across seasons) → our
// canonical 3-letter code. Lookup happens in scripts/build-seed.ts.

export const ISO_CODE_BY_APIFOOTBALL_ID: Record<number, { code: string; name: string }> = {
  // Confirmed from APT-1 verification of /teams?league=1&season=2026
  1532: { code: "ALG", name: "Algeria" },
  26:   { code: "ARG", name: "Argentina" },
  20:   { code: "AUS", name: "Australia" },
  775:  { code: "AUT", name: "Austria" },
  1:    { code: "BEL", name: "Belgium" },
  1113: { code: "BIH", name: "Bosnia & Herzegovina" },
  6:    { code: "BRA", name: "Brazil" },
  5529: { code: "CAN", name: "Canada" },
  1533: { code: "CPV", name: "Cape Verde" },
  8:    { code: "COL", name: "Colombia" },
  1508: { code: "COD", name: "DR Congo" },
  3:    { code: "CRO", name: "Croatia" },
  5530: { code: "CUW", name: "Curaçao" },
  770:  { code: "CZE", name: "Czechia" },
  2382: { code: "ECU", name: "Ecuador" },
  32:   { code: "EGY", name: "Egypt" },
  10:   { code: "ENG", name: "England" },
  2:    { code: "FRA", name: "France" },
  25:   { code: "GER", name: "Germany" },
  1504: { code: "GHA", name: "Ghana" },
  2386: { code: "HAI", name: "Haiti" },
  22:   { code: "IRN", name: "Iran" },
  1567: { code: "IRQ", name: "Iraq" },
  1501: { code: "CIV", name: "Ivory Coast" },
  12:   { code: "JPN", name: "Japan" },
  1548: { code: "JOR", name: "Jordan" },
  16:   { code: "MEX", name: "Mexico" },
  31:   { code: "MAR", name: "Morocco" },
  1118: { code: "NED", name: "Netherlands" },
  4673: { code: "NZL", name: "New Zealand" },
  1090: { code: "NOR", name: "Norway" },
  11:   { code: "PAN", name: "Panama" },
  2380: { code: "PAR", name: "Paraguay" },
  27:   { code: "POR", name: "Portugal" },
  1569: { code: "QAT", name: "Qatar" },
  23:   { code: "KSA", name: "Saudi Arabia" },
  1108: { code: "SCO", name: "Scotland" },
  13:   { code: "SEN", name: "Senegal" },
  1531: { code: "RSA", name: "South Africa" },
  17:   { code: "KOR", name: "South Korea" },
  9:    { code: "ESP", name: "Spain" },
  5:    { code: "SWE", name: "Sweden" },
  15:   { code: "SUI", name: "Switzerland" },
  28:   { code: "TUN", name: "Tunisia" },
  777:  { code: "TUR", name: "Türkiye" },
  2384: { code: "USA", name: "United States" },
  7:    { code: "URU", name: "Uruguay" },
  1568: { code: "UZB", name: "Uzbekistan" },
};
