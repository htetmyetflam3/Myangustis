
const INK = "#0e1626";
const BRAND = "#c63b26";
const VIOLET = "#d9682c";
const TEAL = "#2e7d5b";
const AMBER = "#e0a63c";
const ROSE = "#b32026";

function Line({
  x,
  y,
  w,
  color,
  delay,
}: {
  x: number;
  y: number;
  w: number;
  color: string;
  delay: number;
}) {
  return (
    <rect
      className="fx-line"
      x={x}
      y={y}
      width={w}
      height={12}
      rx={6}
      fill={color}
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

export default function GrammarArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 820"
      className={`svg-fx w-full h-auto ${className}`}
      role="img"
      aria-label="Animated illustration: Burmese spelling and grammar being checked by an AI engine"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient id="ggSky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7ece6" />
          <stop offset="100%" stopColor="#f5f0e6" />
        </linearGradient>
        <linearGradient id="ggBar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f6e6d8" />
          <stop offset="100%" stopColor="#f3ded3" />
        </linearGradient>
        <marker id="ggHead" viewBox="0 0 12 12" refX="7" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L11 6 L1 11 z" fill={VIOLET} />
        </marker>
      </defs>

      <circle cx="300" cy="230" r="200" fill="url(#ggSky)" opacity="0.8" />
      <circle cx="930" cy="600" r="210" fill="url(#ggSky)" opacity="0.7" />

      {/* editor window */}
      <g>
        <rect x="150" y="130" width="770" height="470" rx="34" fill="#fff" stroke={INK} strokeWidth={7} />
        <rect x="174" y="154" width="722" height="84" rx="22" fill="url(#ggBar)" stroke={INK} strokeWidth={5} />
        <circle cx="216" cy="196" r="11" fill={ROSE} stroke={INK} strokeWidth={4} />
        <circle cx="252" cy="196" r="11" fill={AMBER} stroke={INK} strokeWidth={4} />
        <circle cx="288" cy="196" r="11" fill={TEAL} stroke={INK} strokeWidth={4} />
        <text x="330" y="206" fontSize={24} fontWeight={700} fill={INK} fontFamily="JetBrains Mono, monospace">
          burmese_orthography_ai.sys
        </text>

        {/* paragraph with flagged words */}
        <Line x={200} y={286} w={520} color="#e6d8c8" delay={0} />
        <rect className="fx-glow" x={736} y={280} width={120} height={24} rx={8} fill="#f7ded8" stroke={ROSE} strokeWidth={3} />
        <Line x={200} y={334} w={300} color="#e6d8c8" delay={0.2} />
        <rect className="fx-glow" x={520} y={328} width={148} height={24} rx={8} fill="#f8ecd4" stroke={AMBER} strokeWidth={3} style={{ animationDelay: "0.5s" }} />
        <Line x={688} y={334} w={168} color="#e6d8c8" delay={0.4} />
        <Line x={200} y={382} w={656} color="#e6d8c8" delay={0.6} />
        <Line x={200} y={430} w={430} color="#e6d8c8" delay={0.8} />
        <rect className="fx-glow" x={648} y={424} width={128} height={24} rx={8} fill="#e0efe4" stroke={TEAL} strokeWidth={3} style={{ animationDelay: "1s" }} />

        {/* squiggly underline */}
        <path
          className="fx-dash"
          d="M736 316 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0"
          fill="none"
          stroke={ROSE}
          strokeWidth={5}
        />

        {/* typing caret */}
        <rect className="fx-glow" x={636} y={424} width={6} height={28} rx={3} fill={BRAND} />

        {/* status strip */}
        <rect x="200" y="492" width="656" height="70" rx="20" fill="#fdf9f4" stroke={INK} strokeWidth={5} />
        <circle className="fx-spin-fast" cx="240" cy="527" r="17" fill="none" stroke={VIOLET} strokeWidth={6} strokeDasharray="52 30" />
        <text x="276" y="537" fontSize={24} fontWeight={700} fill={INK} fontFamily="Myanmar Sagar, sans-serif">
          Checking orthography, grammar &amp; ligatures…
        </text>
      </g>

      {/* suggestion card */}
      <g className="fx-float">
        <rect x="770" y="620" width="360" height="150" rx="24" fill="#fff" stroke={INK} strokeWidth={7} />
        <rect x="798" y="650" width="120" height="34" rx="17" fill="#f7ded8" stroke={INK} strokeWidth={4} />
        <text x="858" y="674" textAnchor="middle" fontSize={20} fontWeight={800} fill={ROSE} fontFamily="Myanmar Sagar, sans-serif">
          spelling
        </text>
        <path className="fx-slide-x" d="M934 667 h44" stroke={VIOLET} strokeWidth={6} markerEnd="url(#ggHead)" />
        <rect x="994" y="650" width="110" height="34" rx="17" fill="#e0efe4" stroke={INK} strokeWidth={4} />
        <text x="1049" y="674" textAnchor="middle" fontSize={20} fontWeight={800} fill={TEAL} fontFamily="Myanmar Sagar, sans-serif">
          fixed
        </text>
        <Line x={798} y={708} w={240} color="#e6d8c8" delay={0.3} />
        <Line x={798} y={736} w={160} color="#e8ded2" delay={0.5} />
      </g>

      {/* AI core */}
      <g className="fx-float-sm">
        <circle cx="180" cy="680" r="74" fill="#f6e6d8" stroke={INK} strokeWidth={7} />
        <circle className="fx-spin" cx="180" cy="680" r="52" fill="none" stroke={VIOLET} strokeWidth={5} strokeDasharray="26 18" />
        <path d="M152 660 h56 M152 682 h34 M152 704 h46" stroke={INK} strokeWidth={6} />
        <circle className="fx-glow" cx="240" cy="624" r="12" fill={AMBER} stroke={INK} strokeWidth={4} />
      </g>

      {/* score badge */}
      <g className="fx-pop">
        <circle cx="990" cy="196" r="70" fill="#e0efe4" stroke={INK} strokeWidth={7} />
        <text x="990" y="188" textAnchor="middle" fontSize={40} fontWeight={800} fill={INK} fontFamily="Myanmar Sagar, sans-serif">
          98
        </text>
        <text x="990" y="222" textAnchor="middle" fontSize={20} fontWeight={700} fill={TEAL} fontFamily="Myanmar Sagar, sans-serif">
          SCORE
        </text>
      </g>

      {/* connecting dashes */}
      <path className="fx-dash" d="M254 680 H430 Q470 680 470 640 V604" fill="none" stroke={VIOLET} strokeWidth={6} markerEnd="url(#ggHead)" />
      <path className="fx-dash" d="M920 300 H960" fill="none" stroke={VIOLET} strokeWidth={6} markerEnd="url(#ggHead)" />
    </svg>
  );
}
