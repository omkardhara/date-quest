"use client";
import { useState } from "react";
import { motion } from "framer-motion";

// Full-body chibi art lives in /public/chibi/<mood>.png (wave, neutral, excited, happy).
// Until art exists, a soft animated placeholder shows.
export function Chibi({ mood = "neutral", size = 150 }: { mood?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative mx-auto flex items-end justify-center" style={{ height: size }}>
      {/* glow under the character */}
      <div
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full blur-2xl"
        style={{
          width: size * 0.7,
          height: size * 0.25,
          background: "radial-gradient(ellipse, rgba(167,139,250,.5), transparent 70%)",
        }}
      />
      {!broken ? (
        <motion.img
          // eslint-disable-next-line @next/next/no-img-element
          src={`/chibi/${mood}.png`}
          alt="character"
          onError={() => setBroken(true)}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: [0, -6, 0], opacity: 1 }}
          transition={{ y: { duration: 3, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.4 } }}
          style={{ height: size }}
          className="relative object-contain drop-shadow-[0_10px_30px_rgba(99,102,241,.45)]"
        />
      ) : (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative flex items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 text-3xl shadow-xl"
          style={{ height: size * 0.55, width: size * 0.55 }}
        >
          ✨
        </motion.div>
      )}
    </div>
  );
}
