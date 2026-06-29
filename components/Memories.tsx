"use client";
import { useState } from "react";

export interface Memory { src: string; cap: string; }

const DEFAULT: Memory[] = [
  { src: "/memories/1.jpeg", cap: "Gili Islands 🤿" },
  { src: "/memories/2.jpeg", cap: "Sikkim ✨" },
  { src: "/memories/3.jpeg", cap: "waterfall day 💚" },
  { src: "/memories/4.jpeg", cap: "old fort ☀️" },
  { src: "/memories/5.jpeg", cap: "Muscat 🕌" },
];

const TILT = [-3, 2, -2, 3, -1, 2];

function Polaroid({ m, tilt }: { m: Memory; tilt: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="polaroid shrink-0 w-28" style={{ transform: `rotate(${tilt}deg)` }}>
      <div className="frame h-28 w-full">
        {!broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.src} onError={() => setBroken(true)} alt={m.cap} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="text-2xl opacity-60">📷</span>
        )}
      </div>
      <div className="cap">{m.cap}</div>
    </div>
  );
}

export function Memories({ items = DEFAULT, title }: { items?: Memory[]; title?: string }) {
  return (
    <div>
      {title && <p className="mb-2 text-center text-xs uppercase tracking-wider text-white/40">{title}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2 px-1 justify-start sm:justify-center">
        {items.map((m, i) => <Polaroid key={i} m={m} tilt={TILT[i % TILT.length]} />)}
      </div>
    </div>
  );
}
