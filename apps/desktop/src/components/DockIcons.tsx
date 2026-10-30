/** Gömülü dock ikonları — kaynak: ship.svg / PARS radar PPI */

const BADGE_RED = "#ef4444";

export function AisShipIcon() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden fill="currentColor">
      <g transform="translate(0,512) scale(0.1,-0.1)">
        <path d="M2255 4690 c-280 -5 -291 -6 -321 -27 -64 -46 -84 -149 -41 -214 12-19 42 -44 67 -56 41 -22 57 -23 242 -23 l198 0 0 -115 c0 -111 -1 -115 -22-119 -13 -3 -130 -21 -260 -40 -268 -39 -318 -55 -392 -129 -56 -57 -75 -94-140 -278 l-53 -149 36 0 c20 0 252 20 515 44 l479 45 481 -45 c265 -24 495-44 512 -44 l31 0 -53 150 c-66 185 -84 220 -138 274 -76 77 -129 95 -384 132-125 18 -242 36 -259 39 l-33 6 0 114 0 115 198 0 c185 0 201 1 242 23 66 33 93 78 88 148 -5 65 -31 109 -80 132 -39 18 -423 25 -913 17z" />
        <path d="M2110 3375 c-647 -61 -657 -62 -715 -89 -68 -31 -134 -91 -167 -153-26 -47 -222 -677 -216 -693 2 -4 302 104 668 242 366 138 696 259 734 269 84 23 198 25 280 4 34 -9 365 -130 736 -269 371 -139 676 -250 678 -247 6 15-191 649 -216 694 -47 87 -141 157 -239 177 -76 15 -1030 100 -1113 99 -41 -1-235 -16 -430 -34z" />
        <path d="M2490 2753 c-45 -9 -1544 -574 -1576 -594 -49 -30 -123 -115 -146-167 -14 -30 -23 -75 -26 -127 -4 -76 1 -98 102 -477 58 -219 106 -401 106-406 0 -4 -29 -16 -65 -25 -63 -17 -501 -209 -551 -242 -84 -55 -85 -197 -1-257 18 -13 50 -23 81 -26 47 -3 68 4 274 97 281 127 299 133 397 134 113 2 168 -15 305 -94 66 -38 162 -84 213 -102 87 -30 100 -31 242 -32 183 0 240 15 421 111 240 127 348 127 588 0 161 -85 232 -107 377 -113 191 -9 299 21 507 140 130 75 185 92 297 90 98 -1 116 -7 397 -134 206 -93 227 -100 274 -97 31 3 63 13 81 26 84 60 83 202 -2 258 -51 33 -485 224 -550 241 -36 9 -65 21 -65 25 0 5 48 187 106 406 101 379 106 401 102 477 -3 52 -12 97 -26 127 -25 57-101 141 -157 173 -22 12 -379 150 -793 305 -661 247 -761 282 -820 285 -37 2-78 1 -92 -2z" />
      </g>
    </svg>
  );
}

/** Ortak radar PPI gövdesi — TX / A·B / info / MARPA hepsinde aynı */
function RadarGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="256" cy="256" r="200" />
      <circle cx="256" cy="256" r="132" />
      <circle cx="256" cy="256" r="64" />
      <line x1="256" y1="46" x2="256" y2="466" />
      <line x1="46" y1="256" x2="466" y2="256" />
      <line x1="256" y1="256" x2="392" y2="128" />
      <circle cx="168" cy="150" r="18" fill="currentColor" stroke="none" />
      <circle cx="340" cy="340" r="10" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="150" cy="320" r="8" fill="currentColor" stroke="none" opacity="0.4" />
    </g>
  );
}

type RadarBadge = "none" | "A" | "B" | "info";

function RadarMark({ badge = "none" }: { badge?: RadarBadge }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className="dock-radar-mark">
      <g className="dock-radar-mark-body">
        <RadarGlyph />
      </g>
      {badge === "A" || badge === "B" ? (
        <text
          x="395"
          y="460"
          textAnchor="middle"
          fontSize="248"
          fontWeight="900"
          fontFamily="Segoe UI, Arial, sans-serif"
          fill={BADGE_RED}
          stroke="#0a1018"
          strokeWidth="40"
          paintOrder="stroke fill"
        >
          {badge}
        </text>
      ) : null}
      {badge === "info" ? (
        <g transform="translate(286,286)">
          <circle cx="92" cy="92" r="100" fill="#0a1018" stroke={BADGE_RED} strokeWidth="24" />
          <text
            x="92"
            y="132"
            textAnchor="middle"
            fontSize="160"
            fontWeight="900"
            fontFamily="Segoe UI, Arial, sans-serif"
            fill={BADGE_RED}
          >
            !
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export function RadarIcon() {
  return <RadarMark badge="none" />;
}

/** Tek buton: mevcut harf A veya B */
export function RadarIconAB({ letter }: { letter: "A" | "B" }) {
  return <RadarMark badge={letter} />;
}

export function RadarIconA() {
  return <RadarMark badge="A" />;
}

export function RadarIconB() {
  return <RadarMark badge="B" />;
}

export function RadarIconInfo() {
  return <RadarMark badge="info" />;
}

/** Radar + alt yazı (ARPA) — yan menüde diğerleriyle aynı hizada */
export function RadarIconMarpa() {
  return (
    <span className="dock-radar-marpa-icon">
      <RadarMark badge="none" />
      <span className="dock-radar-marpa-label">ARPA</span>
    </span>
  );
}
