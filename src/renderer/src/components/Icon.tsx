// Tiny inline icon set (24×24, stroke based) — no icon library needed.
import type { JSX } from 'react'

const P: Record<string, string> = {
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 11H7.5a2 2 0 0 0-1.9 1.4L3 19',
  save: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  copy: 'M9 9h10v12H9zM5 15H4V3h12v1',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.7-1.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  merge: 'M7 4v5a5 5 0 0 0 5 5h0a5 5 0 0 1 5 5v1M17 4v5a5 5 0 0 1-3 4.6M12 20v0',
  pan: 'M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3M22 12l-3-3m3 3-3 3',
  select: 'M5 3l14 8-6 2-2 6z',
  node: 'M4 20c4-12 12-4 16-16M4 20h0M20 4h0M3 18h3v3H3zM18 3h3v3h-3zM10.5 10.5h3v3h-3z',
  brush: 'M18 3l3 3-9.5 9.5-3-3zM8.5 12.5 6 15c-2 0-3 1.5-3 3.5V21h2.5c2 0 3.5-1 3.5-3l2.5-2.5',
  fill: 'M5 11 12 4l7 7-7 7zM19 15s2 2.3 2 3.5a2 2 0 0 1-4 0c0-1.2 2-3.5 2-3.5ZM2 21h20',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  pick: 'M19.5 4.5a2.1 2.1 0 0 0-3 0L14 7l-1-1-2 2 1 1-7.5 7.5L4 20l3.5-.5L15 12l1 1 2-2-1-1 2.5-2.5a2.1 2.1 0 0 0 0-3Z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 5 5 9-10',
  play: 'M7 4v16l13-8z',
  stop: 'M6 6h12v12H6z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  wand: 'M15 4V2M15 10V8M11 6h2M17 6h2M18.5 2.5 17 4M18.5 9.5 17 8M4 20 14 10l2 2L6 22z',
  heart: 'M12 20s-7-4.4-9-8.6C1.6 8.3 3.6 5 6.8 5c2 0 3.4 1.1 5.2 3 1.8-1.9 3.2-3 5.2-3 3.2 0 5.2 3.3 3.8 6.4-2 4.2-9 8.6-9 8.6Z',
  ai: 'M4 20 9 4h2l5 16M6.5 14h7M19 4v16',
  ps: 'M5 20V4h5.5a4.5 4.5 0 0 1 0 9H5M21 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-2.7.9-2.7 2 0 2.8 6 1.6 6 4.6 0 1.3-1.2 2.4-3.1 2.4-1.5 0-2.8-.6-3.4-1.6',
  split: 'M12 3v18M4 5h16v14H4z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  github: 'M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  split2: 'M8 4v16M16 4v16',
  outline: 'M4 4h16v16H4zM8 8h8v8H8z',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  corner: 'M4 20V8a4 4 0 0 1 4-4h12',
  smooth: 'M4 20c0-9 7-16 16-16',
  line: 'M4 20 20 4',
  combine: 'M8 8h12v12H8zM4 4h12v12H4z',
  info: 'M12 8h0M11 12h1v5h1M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z'
}

export type IconName = keyof typeof P

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name]} />
    </svg>
  )
}
