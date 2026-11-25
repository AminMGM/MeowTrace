import type { VDoc } from '@shared/document'
import { toDxf } from '@shared/exporters/dxf'
import { toEps } from '@shared/exporters/eps'
import { toPdf } from '@shared/exporters/pdf'
import { toPsd } from '@shared/exporters/psd'
import { toSvg } from '@shared/exporters/svg'
import type { FileFilter } from '@shared/api'
import { psdLayers, toPng } from './render'

export type ExportFormat = 'svg' | 'pdf' | 'ai' | 'eps' | 'dxf' | 'psd' | 'png'

export const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'svg', label: 'SVG', hint: 'Web, Figma, Inkscape — named layer groups' },
  { id: 'pdf', label: 'PDF', hint: 'Print — real PDF layers per colour' },
  { id: 'ai', label: 'AI', hint: 'Illustrator (PDF-compatible .ai, keeps layers)' },
  { id: 'eps', label: 'EPS', hint: 'Legacy print & stock sites' },
  { id: 'dxf', label: 'DXF', hint: 'Laser, CNC, vinyl cutters, CAD' },
  { id: 'psd', label: 'PSD', hint: 'Photoshop — one pixel layer per colour' },
  { id: 'png', label: 'PNG', hint: 'High-res bitmap at any scale' }
]

export interface ExportSettings {
  format: ExportFormat
  scale: number
  precision: number
  background: string | null
  mergePaths: boolean
  includeHidden: boolean
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'svg',
  scale: 1,
  precision: 2,
  background: null,
  mergePaths: false,
  includeHidden: false
}

export function filtersFor(f: ExportFormat): FileFilter[] {
  const names: Record<ExportFormat, string> = {
    svg: 'SVG image',
    pdf: 'PDF document',
    ai: 'Adobe Illustrator',
    eps: 'Encapsulated PostScript',
    dxf: 'AutoCAD DXF',
    psd: 'Photoshop document',
    png: 'PNG image'
  }
  return [{ name: names[f], extensions: [f] }]
}

export async function exportDoc(doc: VDoc, s: ExportSettings, title: string): Promise<Uint8Array | string> {
  const o = {
    scale: s.scale,
    precision: s.precision,
    background: s.background,
    mergePaths: s.mergePaths,
    includeHidden: s.includeHidden,
    title
  }
  switch (s.format) {
    case 'svg':
      return toSvg(doc, o)
    case 'pdf':
    case 'ai':
      return toPdf(doc, o)
    case 'eps':
      return toEps(doc, o)
    case 'dxf':
      return toDxf(doc, o)
    case 'png':
      return toPng(doc, { scale: s.scale, background: s.background, includeHidden: s.includeHidden })
    case 'psd': {
      const p = psdLayers(doc, { scale: s.scale, background: s.background, includeHidden: s.includeHidden })
      return toPsd(p.width, p.height, p.layers, p.composite)
    }
  }
}

export function byteSize(data: Uint8Array | string): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.length
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
