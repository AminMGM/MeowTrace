import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ANIME_STYLES } from '@shared/anime'
import type { AnimeStyleId } from '@shared/anime'
import { backToOriginal, convertToAnime } from '../lib/anime'
import { errorText } from '../lib/actions'
import { setState, toast, useStore } from '../lib/store'
import { Icon } from './Icon'

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`

export function AnimeDialog(): JSX.Element | null {
  const open = useStore((s) => s.showAnime)
  const busy = useStore((s) => s.busy)
  const original = useStore((s) => s.animeOriginal)
  const [have, setHave] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [running, setRunning] = useState<AnimeStyleId | null>(null)

  useEffect(() => {
    if (!open) return
    void window.meow.animeStatus().then((list) => setHave(Object.fromEntries(list.map((m) => [m.id, m.downloaded]))))
    const off = window.meow.onAnimeProgress((p) => setProgress((cur) => ({ ...cur, [p.id]: p.received / Math.max(1, p.total) })))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setState({ showAnime: false })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null
  const close = (): void => setState({ showAnime: false })

  const download = async (id: AnimeStyleId): Promise<void> => {
    setProgress((cur) => ({ ...cur, [id]: 0 }))
    try {
      await window.meow.animeDownload(id)
      setHave((cur) => ({ ...cur, [id]: true }))
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setProgress((cur) => {
        const next = { ...cur }
        delete next[id]
        return next
      })
    }
  }

  const apply = async (id: AnimeStyleId): Promise<void> => {
    setRunning(id)
    try {
      await convertToAnime(id)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal anime-modal glass" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Turn into anime">
        <header>
          <span className="anime-badge">
            <Icon name="sparkle" />
          </span>
          <div>
            <h2>Turn into anime</h2>
            <span className="muted small">Repaints the image with an AI model on your computer, then traces the result.</span>
          </div>
          <button className="icon-btn" title="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>

        <div className="anime-grid">
          {ANIME_STYLES.map((s) => {
            const p = progress[s.id]
            const downloading = p !== undefined
            const ready = have[s.id]
            return (
              <div key={s.id} className={`anime-card ${original?.style === s.id ? 'on' : ''}`}>
                <div className="anime-card-head">
                  <b>{s.name}</b>
                  <span className={`licence ${s.commercial ? 'ok' : 'nc'}`} title={s.licence}>
                    {s.commercial ? 'Commercial OK' : 'Non-commercial'}
                  </span>
                </div>
                <span className="muted small">{s.blurb}</span>
                {downloading ? (
                  <div className="anime-progress" aria-label={`Downloading ${s.name}`}>
                    <span style={{ width: `${Math.round(p * 100)}%` }} />
                  </div>
                ) : ready ? (
                  <button className="btn primary small" disabled={busy !== 'idle' || running !== null} onClick={() => void apply(s.id)}>
                    {running === s.id ? (
                      <>
                        <span className="spinner" /> Painting…
                      </>
                    ) : (
                      <>
                        <Icon name="wand" size={14} /> Apply
                      </>
                    )}
                  </button>
                ) : (
                  <button className="btn ghost small" onClick={() => void download(s.id)}>
                    <Icon name="save" size={14} /> Download · {mb(s.bytes)}
                  </button>
                )}
                <button className="link small" onClick={() => void window.meow.openExternal(s.source)} title={s.source}>
                  {s.licence}
                </button>
              </div>
            )
          })}
        </div>

        <footer className="anime-footer">
          <span className="muted small">
            Models download once and run offline. Styles marked non-commercial may only be used for personal, non-commercial work.
          </span>
          {original && (
            <button className="btn ghost small" disabled={busy !== 'idle'} onClick={() => void backToOriginal()}>
              <Icon name="undo" size={14} /> Back to original
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
