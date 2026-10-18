import { useId, type ReactNode } from "react";

type Props = {
  viewBox?: string;
  /** Hide the static lightning ring and the Big Cypress pin, for callers that draw their own. */
  calm?: boolean;
  /** Drawn in map coordinates (600 by 380) above the base map. */
  children?: ReactNode;
};

/** The stylized Everglades map used by the landing page. Decorative. */
export function MiniMap({
  viewBox = "0 0 600 380",
  calm = false,
  children,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const wet = `${uid}-wet`;
  const flood = `${uid}-flood`;
  const heat = `${uid}-heat`;
  const storm = `${uid}-storm`;
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={wet} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#e3ebd6" />
          <path d="M1 6h3M5 3h2" stroke="#b9c9a3" strokeWidth="1" />
        </pattern>
        <pattern
          id={flood}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="rgba(80,120,220,.16)" />
          <path d="M0 0v6" stroke="rgba(80,120,220,.35)" strokeWidth="1.5" />
        </pattern>
        <radialGradient id={heat}>
          <stop offset="0" stopColor="#e5533c" stopOpacity=".32" />
          <stop offset="1" stopColor="#e5533c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={storm}>
          <stop offset="0" stopColor="#d9a400" stopOpacity=".55" />
          <stop offset=".5" stopColor="#5fb04d" stopOpacity=".35" />
          <stop offset="1" stopColor="#5fb04d" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="600" height="380" fill="#f4f2ed" />

      <g fill="none" stroke="#e6e1d6" strokeWidth="1">
        <path d="M-10 60 C80 40 160 90 250 70 S420 30 610 80" />
        <path d="M-10 90 C90 70 170 120 260 100 S430 60 610 110" />
        <path d="M-10 300 C100 280 200 330 300 310 S480 270 610 300" />
        <path d="M-10 330 C110 310 210 360 310 340 S490 300 610 330" />
      </g>

      <path
        d="M600 0 L600 380 L470 380 C480 330 455 300 470 250 C488 195 455 160 478 110 C495 70 480 30 500 0Z"
        fill="#d4e4ee"
      />
      <path
        d="M600 0 L600 380 L470 380 C480 330 455 300 470 250 C488 195 455 160 478 110 C495 70 480 30 500 0Z"
        fill="none"
        stroke="#b7cfdd"
        strokeWidth="1.2"
      />

      <path
        d="M150 190 C200 165 290 175 330 210 C370 245 340 320 270 330 C200 340 140 300 130 255 C125 225 130 205 150 190Z"
        fill={`url(#${wet})`}
      />
      <path
        d="M30 40 C70 25 120 40 115 75 C110 105 60 110 35 95 C15 80 15 55 30 40Z"
        fill={`url(#${wet})`}
      />

      <ellipse
        cx="250"
        cy="95"
        rx="48"
        ry="30"
        fill="#d4e4ee"
        stroke="#b7cfdd"
      />

      <path
        d="M250 125 C240 160 205 180 215 215 C225 250 270 260 262 300 C256 330 230 350 240 385"
        fill="none"
        stroke="#bcd5e4"
        strokeWidth="7"
        strokeLinecap="round"
      />

      <path
        d="M236 150 C220 175 190 190 200 220 C210 255 252 262 246 298 L280 302 C290 260 240 245 232 215 C226 190 262 170 268 140Z"
        fill={`url(#${flood})`}
      />

      <g fill="none" strokeLinecap="round">
        <path
          d="M0 150 C120 150 200 140 330 150 S440 165 480 160"
          stroke="#e4dcc4"
          strokeWidth="6"
        />
        <path
          d="M0 150 C120 150 200 140 330 150 S440 165 480 160"
          stroke="#fbf4dc"
          strokeWidth="4"
        />
        <path
          d="M95 0 C100 120 90 250 110 380"
          stroke="#ddd8cc"
          strokeWidth="4"
        />
        <path
          d="M95 0 C100 120 90 250 110 380"
          stroke="#fff"
          strokeWidth="2.5"
        />
        <path
          d="M330 150 C350 220 400 260 420 380"
          stroke="#ddd8cc"
          strokeWidth="3.5"
        />
        <path
          d="M330 150 C350 220 400 260 420 380"
          stroke="#fff"
          strokeWidth="2"
        />
      </g>

      <path
        d="M0 230 C150 225 300 240 470 232"
        stroke="#c9c3b6"
        strokeDasharray="4 4"
        fill="none"
      />

      <circle cx="390" cy="300" r="95" fill={`url(#${heat})`} />

      <ellipse cx="70" cy="200" rx="80" ry="55" fill={`url(#${storm})`} />

      {!calm && (
        <>
          <circle
            cx="140"
            cy="215"
            r="68"
            fill="rgba(217,115,13,.06)"
            stroke="#d9730d"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <path d="M120 188 l-8 16 h7 l-5 14 14-19 h-7 l6-11z" fill="#d9730d" />
        </>
      )}

      <g
        fontFamily="ui-sans-serif,-apple-system,Segoe UI,sans-serif"
        fill="#9b968a"
      >
        <text
          x="250"
          y="99"
          fontSize="10"
          textAnchor="middle"
          fill="#6f8fa3"
          fontStyle="italic"
        >
          Lake Hollis
        </text>
        <text
          x="235"
          y="270"
          fontSize="11"
          letterSpacing="2"
          textAnchor="middle"
        >
          EVERGLADES
        </text>
        <text
          x="540"
          y="200"
          fontSize="11"
          fill="#7f9db0"
          fontStyle="italic"
          textAnchor="middle"
        >
          Atlantic
        </text>
        <text x="16" y="146" fontSize="9">
          I-75
        </text>
        <text x="40" y="70" fontSize="9" letterSpacing="1">
          CYPRESS
        </text>
        <text x="300" y="327" fontSize="9">
          Tamiami Basin
        </text>
      </g>

      <g transform="translate(300 222)">
        <circle r="9" fill="#fff" stroke="#c9c3b6" />
        <g transform="translate(-6 -6) scale(.5)" fill="#7a5c3d">
          <circle cx="5.5" cy="11" r="2.2" />
          <circle cx="9.5" cy="6.5" r="2.2" />
          <circle cx="14.5" cy="6.5" r="2.2" />
          <circle cx="18.5" cy="11" r="2.2" />
          <path d="M12 12c3 0 5.5 3 5.5 5.5 0 2-1.5 2.5-3 2-1-.4-1.6-.6-2.5-.6s-1.5.2-2.5.6c-1.5.5-3 0-3-2C6.5 15 9 12 12 12z" />
        </g>
      </g>

      <g
        fontFamily="ui-sans-serif,-apple-system,Segoe UI,sans-serif"
        fontSize="11"
        fontWeight="600"
      >
        {!calm && (
          <g transform="translate(150 230)">
            <path d="M0 0 l-6 -9 h12z" fill="#e03e3e" />
            <rect
              x="-18"
              y="-27"
              width="36"
              height="18"
              rx="9"
              fill="#e03e3e"
            />
            <text y="-14" fill="#fff" textAnchor="middle">
              8.6
            </text>
          </g>
        )}
        <g transform="translate(232 196)">
          <path d="M0 0 l-6 -9 h12z" fill="#d9730d" />
          <rect x="-18" y="-27" width="36" height="18" rx="9" fill="#d9730d" />
          <text y="-14" fill="#fff" textAnchor="middle">
            6.9
          </text>
        </g>
        <g transform="translate(400 286)">
          <path d="M0 0 l-6 -9 h12z" fill="#d9730d" />
          <rect x="-18" y="-27" width="36" height="18" rx="9" fill="#d9730d" />
          <text y="-14" fill="#fff" textAnchor="middle">
            6.2
          </text>
        </g>
        <g transform="translate(420 140)">
          <path d="M0 0 l-6 -9 h12z" fill="#cb9b00" />
          <rect x="-18" y="-27" width="36" height="18" rx="9" fill="#cb9b00" />
          <text y="-14" fill="#fff" textAnchor="middle">
            4.1
          </text>
        </g>
        <g transform="translate(330 70)">
          <path d="M0 0 l-6 -9 h12z" fill="#448361" />
          <rect x="-18" y="-27" width="36" height="18" rx="9" fill="#448361" />
          <text y="-14" fill="#fff" textAnchor="middle">
            2.3
          </text>
        </g>
        <g transform="translate(60 330)">
          <path d="M0 0 l-6 -9 h12z" fill="#448361" />
          <rect x="-18" y="-27" width="36" height="18" rx="9" fill="#448361" />
          <text y="-14" fill="#fff" textAnchor="middle">
            1.8
          </text>
        </g>
      </g>

      {children}
    </svg>
  );
}
