"use client";

// The Mise chef — a hand-drawn maître who lives on the auth card.
// He follows your email as you type, claps both hands over his eyes while
// you enter your password, and peeks through his fingers if you hit "show".
// Pure SVG + CSS transforms — no images, crisp at any size, 60fps.

export type ChefMood = "idle" | "watch" | "cover" | "peek" | "happy";

const HAND_T = "transform 480ms cubic-bezier(0.34, 1.56, 0.64, 1)";

export default function ChefMascot({
  mood,
  look = 0,
  className = "",
}: {
  mood: ChefMood;
  /** -1 … 1 — where the eyes look while watching you type */
  look?: number;
  className?: string;
}) {
  const covering = mood === "cover" || mood === "peek";
  const px = Math.max(-1, Math.min(1, look)) * 5; // pupil travel
  const browLift = mood === "watch" ? -3 : 0;

  return (
    <svg
      viewBox="0 0 240 190"
      className={`pointer-events-none select-none ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id="chef-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7cda6" />
          <stop offset="100%" stopColor="#e9a873" />
        </linearGradient>
        <linearGradient id="chef-hat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dfe3e8" />
        </linearGradient>
        <linearGradient id="chef-jacket" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbfcfd" />
          <stop offset="100%" stopColor="#ccd3da" />
        </linearGradient>
      </defs>

      {/* ── jacket / shoulders ── */}
      <path
        d="M40 190 C42 152 74 136 120 136 C166 136 198 152 200 190 Z"
        fill="url(#chef-jacket)"
        stroke="#b9c1c9"
        strokeWidth="1.5"
      />
      {/* double-breasted buttons */}
      <circle cx="108" cy="158" r="2.6" fill="#9aa3ac" />
      <circle cx="108" cy="172" r="2.6" fill="#9aa3ac" />
      <circle cx="132" cy="158" r="2.6" fill="#9aa3ac" />
      <circle cx="132" cy="172" r="2.6" fill="#9aa3ac" />
      {/* neckerchief — the Mise emerald */}
      <path d="M104 138 L120 152 L136 138 L128 134 L120 140 L112 134 Z" fill="#10b981" />
      <circle cx="120" cy="146" r="4" fill="#0c8f66" />

      {/* ── head ── */}
      {/* ears */}
      <circle cx="74" cy="92" r="9" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="1" />
      <circle cx="166" cy="92" r="9" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="1" />
      {/* face */}
      <path
        d="M78 74 C78 46 162 46 162 74 L162 100 C162 128 142 140 120 140 C98 140 78 128 78 100 Z"
        fill="url(#chef-skin)"
      />
      {/* blush */}
      <ellipse cx="90" cy="106" rx="7" ry="4" fill="#f0976b" opacity="0.45" />
      <ellipse cx="150" cy="106" rx="7" ry="4" fill="#f0976b" opacity="0.45" />

      {/* ── toque (chef hat) ── */}
      <g>
        <path
          d="M74 62 C58 30 84 12 102 20 C108 4 132 4 138 20 C156 12 182 30 166 62 Z"
          fill="url(#chef-hat)"
          stroke="#c7cdd4"
          strokeWidth="1.5"
        />
        {/* pleats */}
        <path d="M96 24 L92 58" stroke="#c7cdd4" strokeWidth="1.4" fill="none" />
        <path d="M120 16 L120 58" stroke="#c7cdd4" strokeWidth="1.4" fill="none" />
        <path d="M144 24 L148 58" stroke="#c7cdd4" strokeWidth="1.4" fill="none" />
        {/* band */}
        <rect x="72" y="58" width="96" height="12" rx="6" fill="#ffffff" stroke="#c7cdd4" strokeWidth="1.5" />
      </g>

      {/* ── eyes ── */}
      {mood === "happy" ? (
        <g stroke="#4a3627" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M92 92 Q99 84 106 92" />
          <path d="M134 92 Q141 84 148 92" />
        </g>
      ) : (
        <g>
          {/* brows */}
          <path
            d={`M90 ${80 + browLift} Q99 ${75 + browLift} 108 ${80 + browLift}`}
            stroke="#5b4330" strokeWidth="3.4" strokeLinecap="round" fill="none"
            style={{ transition: "d 300ms ease" }}
          />
          <path
            d={`M132 ${80 + browLift} Q141 ${75 + browLift} 150 ${80 + browLift}`}
            stroke="#5b4330" strokeWidth="3.4" strokeLinecap="round" fill="none"
            style={{ transition: "d 300ms ease" }}
          />
          {/* eyeballs */}
          <ellipse cx="99" cy="93" rx="8.5" ry="9" fill="#fff" stroke="#d9c6b4" strokeWidth="1" />
          <ellipse cx="141" cy="93" rx="8.5" ry="9" fill="#fff" stroke="#d9c6b4" strokeWidth="1" />
          {/* pupils — follow the typing */}
          <g style={{ transform: `translate(${px}px, 1.5px)`, transition: "transform 220ms ease" }}>
            <circle cx="99" cy="93" r="4" fill="#3b2c1e" />
            <circle cx="141" cy="93" r="4" fill="#3b2c1e" />
            <circle cx="100.5" cy="91.5" r="1.3" fill="#fff" />
            <circle cx="142.5" cy="91.5" r="1.3" fill="#fff" />
          </g>
          {/* blink lids */}
          <g className="mise-chef-blink" style={{ transformOrigin: "120px 83px" }}>
            <rect x="89" y="83" width="20" height="0.5" fill="url(#chef-skin)" />
            <rect x="131" y="83" width="20" height="0.5" fill="url(#chef-skin)" />
          </g>
        </g>
      )}

      {/* ── nose · moustache · mouth ── */}
      <path d="M116 96 Q120 106 124 96 Q122 104 120 104 Q118 104 116 96" fill="#e09468" />
      <path
        d="M96 112 Q108 104 120 112 Q132 104 144 112 Q138 120 126 116 Q120 113 114 116 Q102 120 96 112"
        fill="#4a3627"
      />
      {mood === "happy" ? (
        <path d="M106 122 Q120 134 134 122" stroke="#8a5a3b" strokeWidth="3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M111 122 Q120 128 129 122" stroke="#8a5a3b" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      )}

      {/* ── hands (rise to cover the eyes for passwords) ── */}
      {/* left hand */}
      <g
        style={{
          transform: covering
            ? mood === "peek"
              ? "translate(-6px, 0px) rotate(-4deg)"
              : "translate(0px, 0px)"
            : "translate(-30px, 95px) rotate(-30deg)",
          transformOrigin: "96px 96px",
          transition: HAND_T,
        }}
      >
        <g>
          <ellipse cx="97" cy="94" rx="15" ry="13" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="1.2" />
          {/* fingers */}
          <rect x="85" y="82" width="6.5" height="17" rx="3.2" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="0.8" />
          <rect x="92.5" y="79" width="6.5" height="20" rx="3.2" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="0.8" />
          <rect x="100" y="80" width="6.5" height="19" rx="3.2" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="0.8" />
          {/* jacket cuff */}
          <rect x="86" y="103" width="24" height="8" rx="4" fill="#eef1f4" stroke="#c7cdd4" strokeWidth="1" />
        </g>
      </g>
      {/* right hand */}
      <g
        style={{
          transform: covering
            ? mood === "peek"
              ? "translate(6px, 0px) rotate(4deg)"
              : "translate(0px, 0px)"
            : "translate(30px, 95px) rotate(30deg)",
          transformOrigin: "144px 96px",
          transition: HAND_T,
        }}
      >
        <g>
          <ellipse cx="143" cy="94" rx="15" ry="13" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="1.2" />
          <rect x="133" y="80" width="6.5" height="19" rx="3.2" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="0.8" />
          <rect x="140.5" y="79" width="6.5" height="20" rx="3.2" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="0.8" />
          <rect x="148" y="82" width="6.5" height="17" rx="3.2" fill="url(#chef-skin)" stroke="#d8946a" strokeWidth="0.8" />
          <rect x="130" y="103" width="24" height="8" rx="4" fill="#eef1f4" stroke="#c7cdd4" strokeWidth="1" />
        </g>
      </g>
    </svg>
  );
}
