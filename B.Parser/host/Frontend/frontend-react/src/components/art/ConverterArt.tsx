
const INK = "#0e1626";
const BRAND = "#c63b26";
const VIOLET = "#d9682c";
const TEAL = "#2e7d5b";
const AMBER = "#e0a63c";
const ROSE = "#b32026";

function gearPath(cx: number, cy: number, rOuter: number, rInner: number, teeth: number) {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  const tw = step * 0.26;
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    const add = (r: number, ang: number) =>
      pts.push(`${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`);
    add(rInner, a - tw * 1.5);
    add(rOuter, a - tw);
    add(rOuter, a + tw);
    add(rInner, a + tw * 1.5);
  }
  return `M${pts.join("L")}Z`;
}

function Gear({
  cx,
  cy,
  r,
  teeth = 10,
  fill,
  spin = "fx-spin",
  duration,
}: {
  cx: number;
  cy: number;
  r: number;
  teeth?: number;
  fill: string;
  spin?: string;
  duration?: string;
}) {
  return (
    <g className={spin} style={duration ? { animationDuration: duration } : undefined}>
      <path d={gearPath(cx, cy, r, r * 0.76, teeth)} fill={fill} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r={r * 0.34} fill="#fff" stroke={INK} strokeWidth={4} />
    </g>
  );
}

function DocLines({
  x,
  y,
  width,
  rows,
  gap = 22,
  color,
  delay = 0,
  height = 10,
}: {
  x: number;
  y: number;
  width: number;
  rows: number;
  gap?: number;
  color: string;
  delay?: number;
  height?: number;
}) {
  return (
    <g>
      {Array.from({ length: rows }).map((_, i) => (
        <rect
          key={i}
          className="fx-line"
          x={x}
          y={y + i * gap}
          width={i === rows - 1 ? width * 0.62 : width}
          height={height}
          rx={height / 2}
          fill={color}
          opacity={0.9}
          style={{ animationDelay: `${delay + i * 0.16}s` }}
        />
      ))}
    </g>
  );
}

function OutputDoc({
  x,
  y,
  w = 156,
  label,
  badge,
  accent,
  tint,
  delay,
}: {
  x: number;
  y: number;
  w?: number;
  label: string;
  badge: string;
  accent: string;
  tint: string;
  delay: number;
}) {
  return (
    <g className="fx-float-sm" style={{ animationDelay: `${delay}s` }}>
      <path
        d={`M${x} ${y + 16} a16 16 0 0 1 16 -16 h${w - 32} a16 16 0 0 1 16 16 v212 l-40 40 h-${w - 40} a16 16 0 0 1 -16 -16 Z`}
        fill="#fff"
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path d={`M${x + w} ${y + 228} l-40 40 v-26 a14 14 0 0 1 14 -14 Z`} fill={tint} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
      <rect x={x + 16} y={y + 18} width={42} height={38} rx={10} fill={tint} stroke={INK} strokeWidth={4} />
      <text x={x + 37} y={y + 45} textAnchor="middle" fontSize={21} fontWeight={800} fill={accent} fontFamily="Myanmar Sagar, sans-serif">
        {badge}
      </text>
      <text x={x + 66} y={y + 46} fontSize={22} fontWeight={800} fill={INK} fontFamily="Myanmar Sagar, sans-serif" letterSpacing="0.5">
        {label}
      </text>
      <DocLines x={x + 18} y={y + 78} width={w - 36} rows={6} gap={24} color={tint} delay={delay} />
    </g>
  );
}

export default function ConverterArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 820"
      className={`svg-fx w-full h-auto ${className}`}
      role="img"
      aria-label="Animated illustration: a Zawgyi PDF being converted into selectable Unicode DOCX, TXT and PDF files"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient id="akSky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#faf1e9" />
          <stop offset="100%" stopColor="#f2f6ee" />
        </linearGradient>
        <linearGradient id="akBar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f3ded3" />
          <stop offset="55%" stopColor="#f6e6d8" />
          <stop offset="100%" stopColor="#e0efe4" />
        </linearGradient>
        <linearGradient id="akArrow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={BRAND} />
          <stop offset="100%" stopColor={VIOLET} />
        </linearGradient>
        <marker id="akHead" viewBox="0 0 12 12" refX="7" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L11 6 L1 11 z" fill={BRAND} />
        </marker>
        <marker id="akHeadTeal" viewBox="0 0 12 12" refX="7" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L11 6 L1 11 z" fill={TEAL} />
        </marker>
      </defs>

      {/* ambient background */}
      <circle cx="250" cy="180" r="190" fill="url(#akSky)" opacity="0.75" />
      <circle cx="960" cy="620" r="215" fill="url(#akSky)" opacity="0.7" />

      {/* ---------------- cloud + transfer arrows ---------------- */}
      <g className="fx-float">
        <path
          d="M175 128 a58 58 0 0 1 22 -100 a62 62 0 0 1 108 14 a48 48 0 0 1 12 92 Z"
          fill="#fff"
          stroke={INK}
          strokeWidth={6}
        />
        <rect x="206" y="42" width="60" height="70" rx="10" fill="#f7ded8" stroke={INK} strokeWidth={5} />
        <path d="M236 60 c-10 12 -16 24 -8 32 c8 8 22 -4 18 -16 c-4 -12 -12 -18 -10 -16" fill="none" stroke={ROSE} strokeWidth={5} />
        <path d="M266 78 h30" stroke={INK} strokeWidth={5} markerEnd="url(#akHead)" />
      </g>

      {/* cloud -> app (download) */}
      <path
        className="fx-dash"
        d="M330 70 H520 Q548 70 548 104 V150"
        fill="none"
        stroke={BRAND}
        strokeWidth={6}
        markerEnd="url(#akHead)"
      />
      {/* app -> cloud (upload) */}
      <path
        className="fx-dash-rev"
        d="M232 210 Q166 210 166 162 V138"
        fill="none"
        stroke={TEAL}
        strokeWidth={6}
        markerEnd="url(#akHeadTeal)"
      />

      {/* ---------------- app window ---------------- */}
      <g>
        <rect x="208" y="152" width="812" height="330" rx="34" fill="#fff" stroke={INK} strokeWidth={7} />
        <rect x="232" y="176" width="764" height="282" rx="24" fill="#fdfaf6" stroke={INK} strokeWidth={5} />
        <rect x="232" y="176" width="764" height="84" rx="24" fill="url(#akBar)" stroke={INK} strokeWidth={5} />
        <text x="266" y="234" fontSize={44} fontWeight={800} fill={INK} fontFamily="Myanmar Sagar, sans-serif">
          PDF to Text
        </text>

        {/* toolbar file chips */}
        <g transform="translate(524 186)">
          <rect x="0" y="6" width="54" height="62" rx="10" fill="#f7ded8" stroke={INK} strokeWidth={4} />
          <text x="27" y="46" textAnchor="middle" fontSize={17} fontWeight={800} fill={ROSE} fontFamily="Myanmar Sagar, sans-serif">
            PDF
          </text>
          <path className="fx-slide-x" d="M70 38 h34" stroke={INK} strokeWidth={5} markerEnd="url(#akHead)" />
          <rect x="120" y="6" width="54" height="62" rx="10" fill="#f3ded3" stroke={INK} strokeWidth={4} />
          <text x="147" y="46" textAnchor="middle" fontSize={15} fontWeight={800} fill={BRAND} fontFamily="Myanmar Sagar, sans-serif">
            DOCX
          </text>
          <rect x="188" y="6" width="54" height="62" rx="10" fill="#e0efe4" stroke={INK} strokeWidth={4} />
          <text x="215" y="46" textAnchor="middle" fontSize={17} fontWeight={800} fill={TEAL} fontFamily="Myanmar Sagar, sans-serif">
            TXT
          </text>
        </g>

        {/* window controls */}
        <g transform="translate(862 190)">
          <circle cx="18" cy="28" r="18" fill="#fff" stroke={INK} strokeWidth={4} />
          <path d="M10 28 h16" stroke={INK} strokeWidth={4} />
          <circle cx="66" cy="28" r="18" fill="#fff" stroke={INK} strokeWidth={4} />
          <rect x="58" y="20" width="16" height="16" rx="3" fill="none" stroke={INK} strokeWidth={4} />
          <circle cx="114" cy="28" r="18" fill="#f7ded8" stroke={INK} strokeWidth={4} />
          <path d="M107 21 l14 14 M121 21 l-14 14" stroke={ROSE} strokeWidth={4} />
        </g>

        {/* scanning beam inside the app */}
        <g opacity="0.22">
          <rect className="fx-glow" x="252" y="286" width="722" height="8" rx="4" fill={BRAND} opacity="0.25" />
          <rect className="fx-glow" x="252" y="348" width="722" height="8" rx="4" fill={VIOLET} opacity="0.2" style={{ animationDelay: "0.6s" }} />
          <rect className="fx-glow" x="252" y="410" width="722" height="8" rx="4" fill={TEAL} opacity="0.2" style={{ animationDelay: "1.2s" }} />
        </g>
      </g>

      {/* ---------------- source PDF document ---------------- */}
      <g transform="rotate(-2.5)">
        <g className="fx-float">
        <path
          d="M96 316 a18 18 0 0 1 18 -18 h218 a18 18 0 0 1 18 18 v242 l-52 52 h-184 a18 18 0 0 1 -18 -18 Z"
          fill="#fff"
          stroke={INK}
          strokeWidth={7}
        />
        <path d="M350 558 l-52 52 v-34 a18 18 0 0 1 18 -18 Z" fill="#f7ded8" stroke={INK} strokeWidth={6} />
        <rect x="96" y="298" width="254" height="76" rx="18" fill="#f7ded8" stroke={INK} strokeWidth={6} />
        <path d="M150 316 c-12 16 -20 32 -10 42 c11 10 28 -6 23 -20 c-5 -14 -16 -24 -13 -22" fill="none" stroke={ROSE} strokeWidth={6} />
        <text x="214" y="352" fontSize={34} fontWeight={800} fill={INK} fontFamily="Myanmar Sagar, sans-serif">
          PDF
        </text>
        <DocLines x={120} y={398} width={206} rows={6} gap={27} color="#f2cfc7" delay={0.1} height={12} />
        </g>
      </g>

      {/* ---------------- converting pill + big arrow ---------------- */}
      <g className="fx-float-sm" style={{ animationDelay: "0.4s" }}>
        <rect x="392" y="300" width="286" height="72" rx="36" fill="#fff" stroke={INK} strokeWidth={6} />
        <g transform="translate(432 336)">
          <Gear cx={0} cy={0} r={20} teeth={9} fill={AMBER} spin="fx-spin-fast" />
        </g>
        <text x="468" y="348" fontSize={26} fontWeight={800} fill={INK} fontFamily="Myanmar Sagar, sans-serif" letterSpacing="1">
          CONVERTING...
        </text>
        <g className="fx-slide-x">
          <path
            d="M612 288 l84 48 l-84 48 v-26 h-30 v-44 h30 Z"
            fill="url(#akArrow)"
            stroke={INK}
            strokeWidth={6}
            strokeLinejoin="round"
          />
        </g>
        <path className="fx-glow" d="M378 268 l14 -26 M690 268 l-14 -26" stroke={AMBER} strokeWidth={7} />
      </g>

      {/* ---------------- output documents ---------------- */}
      <OutputDoc x={702} y={292} label="DOCX" badge="W" accent={BRAND} tint="#f3ded3" delay={0.1} />
      <OutputDoc x={870} y={292} label="TXT" badge="T" accent={TEAL} tint="#e0efe4" delay={0.45} />
      <OutputDoc x={1038} y={292} w={150} label="PDF" badge="A" accent={VIOLET} tint="#f6e6d8" delay={0.8} />

      {/* ---------------- baseline rail ---------------- */}
      <path d="M356 688 H1042" stroke={INK} strokeWidth={6} opacity="0.85" />
      <path d="M1042 688 V562" stroke={INK} strokeWidth={6} opacity="0.4" />
      <path d="M1086 688 V562" stroke={INK} strokeWidth={6} opacity="0.4" />

      {/* ---------------- mascot + desk ---------------- */}
      <g>
        {/* antenna */}
        <path className="fx-glow" d="M556 452 l-22 44 h22 l-14 40 l38 -56 h-24 l16 -28 Z" fill={AMBER} stroke={INK} strokeWidth={5} />
        {/* body */}
        <path d="M478 640 q0 -66 74 -66 q74 0 74 66 Z" fill="#f3ded3" stroke={INK} strokeWidth={6} />
        <ellipse cx="552" cy="612" rx="18" ry="22" fill={AMBER} stroke={INK} strokeWidth={5} />
        {/* pointing arm */}
        <path d="M486 600 l-52 18 l-26 -6" fill="none" stroke={INK} strokeWidth={7} />
        <path d="M414 604 a16 16 0 1 0 0 24 h24 a12 12 0 0 0 0 -24 Z" fill="#f3ded3" stroke={INK} strokeWidth={5} />
        {/* head */}
        <circle cx="552" cy="546" r="58" fill="#fff" stroke={INK} strokeWidth={7} />
        {/* headphones */}
        <path d="M486 546 a66 58 0 0 1 132 0" fill="none" stroke={INK} strokeWidth={8} />
        <rect x="464" y="528" width="34" height="52" rx="16" fill={VIOLET} stroke={INK} strokeWidth={6} />
        <rect x="606" y="528" width="34" height="52" rx="16" fill={VIOLET} stroke={INK} strokeWidth={6} />
        {/* glasses */}
        <circle cx="530" cy="544" r="23" fill="#faf1e9" stroke={INK} strokeWidth={5} />
        <circle cx="580" cy="544" r="23" fill="#faf1e9" stroke={INK} strokeWidth={5} />
        <path d="M553 544 h4" stroke={INK} strokeWidth={5} />
        <circle className="fx-blink" cx="530" cy="545" r="9" fill={INK} />
        <circle className="fx-blink" cx="580" cy="545" r="9" fill={INK} style={{ animationDelay: "0.06s" }} />
        {/* smile + cheeks */}
        <path d="M534 576 q18 20 36 0 q-18 8 -36 0 Z" fill={ROSE} stroke={INK} strokeWidth={4} />
        <circle cx="508" cy="570" r="7" fill="#f2cfc7" />
        <circle cx="598" cy="570" r="7" fill="#f2cfc7" />
        {/* desk */}
        <rect x="414" y="636" width="276" height="22" rx="10" fill="#fff" stroke={INK} strokeWidth={6} />
        <rect x="446" y="658" width="20" height="32" fill="#fff" stroke={INK} strokeWidth={6} />
        <rect x="638" y="658" width="20" height="32" fill="#fff" stroke={INK} strokeWidth={6} />
      </g>

      {/* ---------------- scanned page + magnifier lens ---------------- */}
      <g>
        <path
          d="M104 612 a16 16 0 0 1 16 -16 h176 a16 16 0 0 1 16 16 v182 a16 16 0 0 1 -16 16 h-176 a16 16 0 0 1 -16 -16 Z"
          fill="#fff"
          stroke={INK}
          strokeWidth={6}
        />
        <DocLines x={128} y={630} width={158} rows={6} gap={24} color="#e6d8c8" delay={0.2} />
      </g>
      <g className="fx-lens">
        <circle cx="258" cy="736" r="44" fill="#faf1e9" fillOpacity="0.7" stroke={INK} strokeWidth={7} />
        <circle cx="258" cy="736" r="31" fill="none" stroke={BRAND} strokeWidth={4} opacity="0.55" />
        <path d="M244 728 h28 M244 742 h18" stroke={BRAND} strokeWidth={5} />
        <path d="M290 768 l30 30" stroke={INK} strokeWidth={12} />
        <path d="M290 768 l30 30" stroke={TEAL} strokeWidth={5} />
      </g>

      {/* ---------------- gear cluster + status ---------------- */}
      <g>
        <circle className="fx-pop" cx="820" cy="640" r="36" fill="#e0efe4" stroke={INK} strokeWidth={6} />
        <path className="fx-pop" d="M802 640 l12 14 l24 -28" fill="none" stroke={TEAL} strokeWidth={7} />
        <Gear cx={906} cy={732} r={58} teeth={12} fill="#f3ded3" spin="fx-spin" duration="9s" />
        <Gear cx={1010} cy={668} r={46} teeth={10} fill="#f6e6d8" spin="fx-spin-rev" duration="7s" />
        <Gear cx={1006} cy={776} r={34} teeth={9} fill="#f8ecd4" spin="fx-spin" duration="5s" />
        <Gear cx={1096} cy={740} r={26} teeth={8} fill="#e0efe4" spin="fx-spin-rev" duration="4s" />
        <g className="fx-spin" style={{ animationDuration: "7s" }}>
          <path
            d="M1058 576 a44 44 0 0 1 72 -16 M1130 560 v26 h-26"
            fill="none"
            stroke={TEAL}
            strokeWidth={7}
          />
          <path d="M1142 616 a44 44 0 0 1 -72 16 M1070 632 v-26 h26" fill="none" stroke={BRAND} strokeWidth={7} />
        </g>
      </g>
    </svg>
  );
}
