// Left panel: Vector Magic-style guided settings plus advanced controls.
import { useState } from 'react'
import type { JSX } from 'react'
import { KIND_LABELS, autoSpeckle, presetFor, resolveSettings } from '@shared/settings'
import type { Detail, ImageKind, TraceMode, TraceSettings } from '@shared/settings'
import { resetSettings, retrace, tweak, updateSettings } from '../lib/actions'
import { paletteHex } from '../lib/labels'
import { getState, toast, useStore } from '../lib/store'
import { Icon } from './Icon'
import { Section, Segmented, Slider, Toggle } from './ui'

const KINDS: { id: ImageKind; icon: string; blurb: string }[] = [
  { id: 'auto', icon: '✦', blurb: 'Detect it for me' },
  { id: 'photo', icon: '◐', blurb: 'Gradients, many colours' },
  { id: 'logo', icon: '◆', blurb: 'Flat colours, crisp edges' },
  { id: 'logo-aa', icon: '◇', blurb: 'Flat colours, soft edges' },
  { id: 'lineart', icon: '✎', blurb: 'Black & white drawings' },
  { id: 'centerline', icon: '〰', blurb: 'Single strokes for plotters' },
  { id: 'pixel', icon: '▦', blurb: 'Keep every pixel square' }
]

interface Preset {
  name: string
  settings: TraceSettings
}

function loadPresets(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem('meowtrace.presets') ?? '[]') as Preset[]
  } catch {
    return []
  }
}

export function Sidebar(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const analysis = useStore((s) => s.analysis)
  const source = useStore((s) => s.source)
  const seg = useStore((s) => s.seg)
  const timings = useStore((s) => s.timings)
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [newColor, setNewColor] = useState('#c61a08')
  const [presetName, setPresetName] = useState('')

  const eff = resolveSettings(settings, analysis)
  const mode: TraceMode = eff.mode
  const colorCount = seg ? seg.palette.length / 4 : 0
  const autoColors = settings.kind === 'auto' ? eff.colors : settings.colors

  const pickKind = (kind: ImageKind): void => {
    if (kind === 'auto') updateSettings({ kind: 'auto', colors: 0, speckle: -1, upscale: false }, true)
    else updateSettings({ kind, ...presetFor(kind), colors: kind === 'photo' ? 16 : kind === 'lineart' || kind === 'centerline' ? 2 : 0 }, true)
  }

  const setMode = (m: TraceMode): void => {
    if (m === 'bw' || m === 'centerline') tweak({ mode: m, removeBackground: true }, true)
    else tweak({ mode: m }, true)
  }

  const savePreset = (): void => {
    const name = presetName.trim()
    if (!name) return
    setPresetName('')
    const next = [...presets.filter((p) => p.name !== name), { name, settings }]
    setPresets(next)
    localStorage.setItem('meowtrace.presets', JSON.stringify(next))
    toast(`Preset “${name}” saved`, 'ok')
  }

  const applyPreset = (name: string): void => {
    const p = presets.find((x) => x.name === name)
    if (p) updateSettings(p.settings, true)
  }

  const deletePreset = (name: string): void => {
    const next = presets.filter((p) => p.name !== name)
    setPresets(next)
    localStorage.setItem('meowtrace.presets', JSON.stringify(next))
  }

  const useCurrentColors = (): void => {
    const st = getState()
    if (!st.seg) return
    updateSettings({ palette: paletteHex(st.seg), lockPalette: true }, true)
    toast('Palette locked to the current colours', 'ok')
  }

  const speckleValue = settings.speckle >= 0 ? settings.speckle : source ? autoSpeckle(settings.detail, source.pw, source.ph) : 4

  return (
    <aside className="panel sidebar glass">
      <div className="panel-scroll">
        <Section
          title="1 · Image type"
          aside={
            settings.kind === 'auto' && analysis ? <span className="chip">{KIND_LABELS[analysis.kind].split(' ')[0]}</span> : null
          }
        >
          <div className="kind-grid">
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={`kind ${settings.kind === k.id ? 'on' : ''}`}
                onClick={() => pickKind(k.id)}
                title={k.blurb}
              >
                <span className="kind-icon">{k.icon}</span>
                <span className="kind-name">{KIND_LABELS[k.id].replace(' (single strokes)', '').replace(' (exact squares)', '')}</span>
                <span className="kind-blurb">{k.blurb}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="2 · Colours" aside={colorCount ? <span className="chip">{colorCount} used</span> : null}>
          <Segmented
            value={mode === 'pixel' ? 'color' : mode}
            onChange={(m) => setMode(m as TraceMode)}
            options={[
              { value: 'bw', label: 'B&W' },
              { value: 'gray', label: 'Gray' },
              { value: 'color', label: 'Colour' },
              { value: 'centerline', label: 'Lines', title: 'Centerline strokes' }
            ]}
          />
          {(mode === 'color' || mode === 'gray' || mode === 'pixel') && !settings.lockPalette && (
            <>
              <Toggle
                label="Automatic colour count"
                checked={autoColors === 0}
                onChange={(v) => tweak({ colors: v ? 0 : Math.max(2, colorCount || 6) })}
              />
              {autoColors !== 0 && (
                <Slider
                  label="Colours"
                  min={2}
                  max={64}
                  value={Math.max(2, autoColors)}
                  onChange={(v) => tweak({ colors: v })}
                />
              )}
              {autoColors === 0 && (
                <Slider
                  label="Merge similar colours"
                  min={0.02}
                  max={0.2}
                  step={0.005}
                  value={settings.merge}
                  format={(v) => (v < 0.05 ? 'Keep' : v < 0.1 ? 'Balanced' : 'Merge')}
                  onChange={(v) => updateSettings({ merge: v })}
                  hint={['more colours', 'fewer']}
                />
              )}
            </>
          )}
          {(mode === 'bw' || mode === 'centerline') && (
            <>
              <Toggle label="Automatic threshold" checked={settings.threshold < 0} onChange={(v) => updateSettings({ threshold: v ? -1 : 128 })} />
              {settings.threshold >= 0 && (
                <Slider label="Threshold" min={1} max={254} value={settings.threshold} onChange={(v) => updateSettings({ threshold: v })} hint={['less ink', 'more ink']} />
              )}
              <Toggle label="Invert (light ink on dark)" checked={settings.invert} onChange={(v) => updateSettings({ invert: v })} />
            </>
          )}
          {mode !== 'bw' && mode !== 'centerline' && (
            <div className="palette-box">
              <Toggle
                label="Lock to brand palette"
                checked={settings.lockPalette}
                hint="Snap every pixel to these exact colours"
                onChange={(v) => updateSettings({ lockPalette: v && settings.palette.length > 0 })}
              />
              <div className="swatches">
                {settings.palette.map((c, i) => (
                  <span key={`${c}-${i}`} className="swatch-edit" title={c}>
                    <input
                      type="color"
                      value={c}
                      onChange={(e) => {
                        const p = settings.palette.slice()
                        p[i] = e.target.value
                        updateSettings({ palette: p })
                      }}
                    />
                    <button
                      className="swatch-x"
                      title="Remove"
                      onClick={() => {
                        const p = settings.palette.filter((_, k) => k !== i)
                        updateSettings({ palette: p, lockPalette: settings.lockPalette && p.length > 0 })
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <span className="swatch-add">
                  <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} title="Pick a colour" />
                  <button title="Add colour" onClick={() => updateSettings({ palette: [...settings.palette, newColor] })}>
                    <Icon name="plus" size={14} />
                  </button>
                </span>
              </div>
              <div className="row-buttons">
                <button className="btn ghost small" onClick={useCurrentColors} disabled={!seg}>
                  Use traced colours
                </button>
                <input
                  className="hex-input"
                  placeholder="#hex, #hex…"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const vals = e.currentTarget.value.match(/#?[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []
                    const hex = vals.map((v) => (v.startsWith('#') ? v : '#' + v).toLowerCase())
                    if (hex.length) updateSettings({ palette: [...settings.palette, ...hex] })
                    e.currentTarget.value = ''
                  }}
                />
              </div>
            </div>
          )}
        </Section>

        <Section title="3 · Detail">
          <Segmented<Detail>
            value={settings.detail}
            onChange={(d) => updateSettings({ detail: d, speckle: -1 })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' }
            ]}
          />
          {mode !== 'centerline' && (
            <Segmented
              small
              value={settings.stacked ? 'stacked' : 'cut'}
              onChange={(v) => updateSettings({ stacked: v === 'stacked' })}
              options={[
                { value: 'stacked', label: 'Stacked shapes', title: 'Shapes overlap — no gaps, easy recolouring' },
                { value: 'cut', label: 'Cut-out shapes', title: 'Shapes tile without overlapping — for cutters' }
              ]}
            />
          )}
          <Toggle label="Remove background" checked={eff.removeBackground} onChange={(v) => tweak({ removeBackground: v })} />
        </Section>

        <Section title="Advanced" collapsible defaultOpen={false}>
          <Toggle label="Allow curves" checked={settings.curves} onChange={(v) => updateSettings({ curves: v })} hint="Off = straight lines only" />
          {mode !== 'centerline' && (
            <Slider
              label="Corners"
              min={0}
              max={1.33}
              step={0.01}
              value={eff.cornerThreshold}
              format={(v) => (v < 0.6 ? 'Sharp' : v > 1.15 ? 'Round' : 'Balanced')}
              onChange={(v) => tweak({ cornerThreshold: v })}
              hint={['sharp', 'round']}
            />
          )}
          <Slider
            label={mode === 'centerline' ? 'Line simplification' : 'Curve fitting'}
            min={0.05}
            max={1.5}
            step={0.05}
            value={mode === 'centerline' ? settings.lineTolerance : settings.curveTolerance}
            format={(v) => v.toFixed(2)}
            onChange={(v) => updateSettings(mode === 'centerline' ? { lineTolerance: v } : { curveTolerance: v })}
            hint={['precise', 'fewer nodes']}
          />
          <Slider
            label="Ignore specks smaller than"
            min={0}
            max={400}
            value={speckleValue}
            format={(v) => `${v} px²`}
            onChange={(v) => tweak({ speckle: v })}
          />
          <Slider
            label="Edge smoothing"
            min={0}
            max={3}
            value={eff.smoothPasses}
            onChange={(v) => tweak({ smoothPasses: v })}
            hint={['off', 'strong']}
          />
          <Slider
            label="Sharpen"
            min={0}
            max={2}
            step={0.1}
            value={eff.sharpen}
            format={(v) => (v === 0 ? 'Off' : v.toFixed(1))}
            onChange={(v) => tweak({ sharpen: v })}
            hint={['off', 'crisp']}
          />
          <Toggle
            label="Snap anti-aliased edges"
            checked={eff.snapEdges}
            onChange={(v) => tweak({ snapEdges: v })}
            hint="Removes outline slivers and keeps thin text strokes"
          />
          <span className="field-label">Clean-up before tracing</span>
          <Segmented
            small
            value={eff.denoise}
            onChange={(v) => tweak({ denoise: v as 0 | 1 | 2 })}
            options={[
              { value: 0, label: 'None' },
              { value: 1, label: 'Despeckle' },
              { value: 2, label: 'Smooth' }
            ]}
          />
          <Toggle
            label="Upscale 2× before tracing"
            checked={eff.upscale}
            onChange={(v) => tweak({ upscale: v })}
            hint="Smoother curves for small or low-res images"
          />
          <Toggle label="Optimise curves" checked={settings.optimize} onChange={(v) => updateSettings({ optimize: v })} />
          <Slider label="Coordinate precision" min={0} max={4} value={settings.precision} format={(v) => `${v} dp`} onChange={(v) => updateSettings({ precision: v })} />
        </Section>

        <Section title="Presets" collapsible defaultOpen={false}>
          <div className="preset-list">
            {presets.length === 0 && <p className="muted small">Save your favourite settings for one-click reuse and batch jobs.</p>}
            {presets.map((p) => (
              <div key={p.name} className="preset">
                <button className="btn ghost small grow" onClick={() => applyPreset(p.name)}>
                  {p.name}
                </button>
                <button className="icon-btn" title="Delete preset" onClick={() => deletePreset(p.name)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="row-buttons">
            <input
              className="hex-input"
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePreset()}
            />
            <button className="btn ghost small" onClick={savePreset} disabled={!presetName.trim()}>
              Save
            </button>
            <button className="btn ghost small" onClick={resetSettings}>
              Reset
            </button>
          </div>
        </Section>
      </div>
      <footer className="sidebar-foot">
        {source ? (
          <>
            <span>
              {source.width}×{source.height}
            </span>
            {timings.segment !== undefined && <span>trace {Math.round((timings.segment ?? 0) + (timings.vectorize ?? 0))} ms</span>}
            <button className="btn ghost small" onClick={() => void retrace(false)} title="Trace again">
              <Icon name="refresh" size={14} /> Re-trace
            </button>
          </>
        ) : (
          <span className="muted">Open an image to start</span>
        )}
      </footer>
    </aside>
  )
}
