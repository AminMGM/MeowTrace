import { useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export function Section({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  aside
}: {
  title: string
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  aside?: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header onClick={collapsible ? () => setOpen(!open) : undefined} className={collapsible ? 'clickable' : ''}>
        <h3>{title}</h3>
        {aside}
        {collapsible && <Icon name={open ? 'up' : 'down'} size={14} />}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  small
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  small?: boolean
}): JSX.Element {
  return (
    <div className={`segmented ${small ? 'small' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: [string, string]
}): JSX.Element {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <span className="slider-hint">
          <span>{hint[0]}</span>
          <span>{hint[1]}</span>
        </span>
      )}
    </label>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  hint
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}): JSX.Element {
  return (
    <label className="toggle" title={hint}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  )
}

export function IconButton({
  icon,
  title,
  onClick,
  active,
  disabled,
  size = 18,
  className = ''
}: {
  icon: IconName
  title: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  size?: number
  className?: string
}): JSX.Element {
  return (
    <button
      className={`icon-btn ${active ? 'on' : ''} ${className}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
