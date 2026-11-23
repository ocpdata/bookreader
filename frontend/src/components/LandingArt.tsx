import type { ReactNode } from 'react'
import Box from '@mui/material/Box'

const TEAL = '#147D85'
const TEAL_LIGHT = '#E6F3F3'
const INK = '#172033'
const MUTED = '#596579'
const LINE = '#E4E7EC'

export type LandingIconName = 'upload' | 'folder' | 'play' | 'resume' | 'search' | 'image' | 'trash' | 'chart' | 'lock'

const ICONS: Record<LandingIconName, ReactNode> = {
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5z" />
    </>
  ),
  resume: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
}

/** Icono lineal sobre un círculo suave; decorativo, por eso no se anuncia a los lectores de pantalla. */
export function LandingIcon({ name, size = 52 }: { name: LandingIconName; size?: number }) {
  return (
    <Box
      aria-hidden="true"
      sx={{ width: size, height: size, borderRadius: '50%', bgcolor: TEAL_LIGHT, display: 'grid', placeItems: 'center', flexShrink: 0 }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </svg>
    </Box>
  )
}

/** Reproductor ilustrado con una carpeta y una estrella flotando: resume la idea de biblioteca que se escucha. */
export function HeroArt() {
  return (
    <Box
      component="svg"
      aria-hidden="true"
      viewBox="0 0 360 300"
      sx={{ width: '100%', maxWidth: 440, height: 'auto', display: 'block', mx: 'auto' }}
    >
      <circle cx="180" cy="150" r="140" fill={TEAL_LIGHT} />
      <rect x="40" y="36" width="280" height="226" rx="22" fill="#fff" stroke={LINE} strokeWidth="2" />

      <rect x="64" y="62" width="92" height="116" rx="12" fill={TEAL} />
      <rect x="76" y="76" width="68" height="8" rx="4" fill="#fff" opacity="0.9" />
      <rect x="76" y="92" width="46" height="6" rx="3" fill="#fff" opacity="0.55" />
      <path d="M92 178v-34l14 9 14-9v34" fill="#fff" opacity="0.9" />

      <rect x="172" y="72" width="116" height="12" rx="6" fill={INK} />
      <rect x="172" y="94" width="84" height="9" rx="4.5" fill={MUTED} opacity="0.5" />
      <rect x="172" y="116" width="100" height="9" rx="4.5" fill={LINE} />
      <rect x="172" y="134" width="70" height="9" rx="4.5" fill={LINE} />

      <rect x="64" y="200" width="232" height="6" rx="3" fill={LINE} />
      <rect x="64" y="200" width="128" height="6" rx="3" fill={TEAL} />
      <circle cx="192" cy="203" r="8" fill={TEAL} />

      <g transform="translate(268 8)">
        <rect width="86" height="40" rx="12" fill="#fff" stroke={LINE} strokeWidth="2" />
        <path d="M16 14a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2z" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="42" y="15" width="30" height="6" rx="3" fill={LINE} />
        <rect x="42" y="25" width="20" height="6" rx="3" fill={LINE} />
      </g>

      <g transform="translate(14 120)">
        <rect width="62" height="44" rx="12" fill="#fff" stroke={LINE} strokeWidth="2" />
        <path d="M31 10l3.6 7.4 8.1 1.1-5.9 5.7 1.4 8.1-7.2-3.9-7.2 3.9 1.4-8.1-5.9-5.7 8.1-1.1z" fill="#F5B83D" />
      </g>

      <circle cx="180" cy="236" r="16" fill={TEAL} />
      <path d="M176 229v14l12-7z" fill="#fff" />
    </Box>
  )
}
