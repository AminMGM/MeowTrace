// Title bar, settings/about dialog and toasts.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { AppInfo, AppSettings, UpdaterStatus } from '@shared/api'
import { openDialog, redo, undo } from '../lib/actions'
import { formatBytes } from '../lib/exporting'
import { setState, useStore } from '../lib/store'
import { Icon } from './Icon'
import { Toggle } from './ui'
import iconUrl from '../assets/icon.png'

const REPO = 'https://github.com/AminMGM/MeowTrace'

function useUpdater(): UpdaterStatus {
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' })
  useEffect(() => {
    void window.meow.updaterStatus().then(setStatus)
    return window.meow.onUpdaterStatus(setStatus)
  }, [])
  return status
}

export function TitleBar(): JSX.Element {
  const page = useStore((s) => s.page)
  const source = useStore((s) => s.source)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const status = useUpdater()

  return (
    <header className="titlebar">
      <div className="brand">
        <img src={iconUrl} alt="" />
        <span>
          Meow<b>Trace</b>
        </span>
      </div>
      <nav className="tabs">
        <button className={page === 'trace' ? 'on' : ''} onClick={() => setState({ page: 'trace' })}>
          Trace
        </button>
        <button className={page === 'batch' ? 'on' : ''} onClick={() => setState({ page: 'batch' })}>
          Batch
        </button>
      </nav>
      <div className="title-actions">
        <button className="icon-btn" title="Open image (Ctrl+O)" onClick={() => void openDialog()}>
          <Icon name="open" size={17} />
        </button>
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" size={17} />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" size={17} />
        </button>
      </div>
      <div className="title-file">
        {source && page === 'trace' && (
          <span title={source.path}>
            {source.name} <i>· {formatBytes(source.bytes)}</i>
          </span>
        )}
      </div>
      <div className="title-right">
        {status.state === 'downloading' && <span className="update-pill">Updating {Math.round(status.percent ?? 0)}%</span>}
        {status.state === 'downloaded' && (
          <button className="update-pill ready" onClick={() => void window.meow.installUpdate()}>
            Restart to update to {status.version}
          </button>
        )}
        <button className="icon-btn" title="Settings & about" onClick={() => setState({ showSettings: true })}>
          <Icon name="gear" size={17} />
        </button>
      </div>
    </header>
  )
}

export function SettingsDialog(): JSX.Element | null {
  const open = useStore((s) => s.showSettings)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const status = useUpdater()

  useEffect(() => {
    if (!open) return
    void window.meow.appInfo().then(setInfo)
    void window.meow.getSettings().then(setSettings)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setState({ showSettings: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const save = async (patch: Partial<AppSettings>): Promise<void> => setSettings(await window.meow.setSettings(patch))

  const updateText: Record<UpdaterStatus['state'], string> = {
    idle: 'Not checked yet',
    checking: 'Checking…',
    available: `Version ${status.version} found — downloading`,
    'not-available': status.message ?? 'You are on the latest version',
    downloading: `Downloading ${Math.round(status.percent ?? 0)}%${status.total ? ` of ${formatBytes(status.total)}` : ''}`,
    downloaded: `Version ${status.version} is ready`,
    error: status.message ?? 'Update check failed'
  }

  return (
    <div className="modal-backdrop" onPointerDown={() => setState({ showSettings: false })}>
      <div className="modal glass" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <header>
          <img src={iconUrl} alt="" />
          <div>
            <h2>MeowTrace</h2>
            <span className="muted small">
              Version {info?.version ?? '…'} · Electron {info?.electron ?? '…'}
            </span>
          </div>
          <button className="icon-btn" title="Close" onClick={() => setState({ showSettings: false })}>
            <Icon name="close" />
          </button>
        </header>

        <section>
          <h3>Updates</h3>
          <p className="small">{updateText[status.state]}</p>
          <p className="muted small">Updates download only the changed parts of the app (differential updates), not the whole installer.</p>
          {settings && <Toggle label="Check for updates on start" checked={settings.checkUpdates} onChange={(v) => void save({ checkUpdates: v })} />}
          <div className="row-buttons">
            <button className="btn ghost small" onClick={() => void window.meow.checkForUpdates()} disabled={status.state === 'checking' || status.state === 'downloading'}>
              <Icon name="refresh" size={14} /> Check now
            </button>
            {status.state === 'downloaded' && (
              <button className="btn primary small" onClick={() => void window.meow.installUpdate()}>
                Restart & update
              </button>
            )}
          </div>
        </section>

        <section>
          <h3>Adobe live bridge</h3>
          <p className="muted small">
            Lets the optional MeowTrace UXP plugin pull your latest “Send to” straight into the open Illustrator or Photoshop document. Local only
            (127.0.0.1).
          </p>
          {settings && (
            <>
              <Toggle label="Enable bridge" checked={settings.bridgeEnabled} onChange={(v) => void save({ bridgeEnabled: v })} />
              <label className="inline-field">
                Port
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  defaultValue={settings.bridgePort}
                  onBlur={(e) => void save({ bridgePort: Number(e.target.value) })}
                />
              </label>
            </>
          )}
        </section>

        <section>
          <h3>Shortcuts</h3>
          <div className="shortcuts">
            {[
              ['Ctrl+O', 'Open'],
              ['Ctrl+S', 'Save / export'],
              ['Ctrl+Shift+C', 'Copy SVG'],
              ['Ctrl+V', 'Paste image'],
              ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
              ['1–6', 'View modes'],
              ['V A H', 'Select · Nodes · Pan'],
              ['B G X I', 'Paint · Fill · Zap · Pick'],
              ['Space+drag', 'Pan'],
              ['Ctrl+0 / Ctrl+1', 'Fit / 100%'],
              ['Del', 'Delete node or shape'],
              ['Esc', 'Deselect']
            ].map(([k, v]) => (
              <span key={k}>
                <kbd>{k}</kbd> {v}
              </span>
            ))}
          </div>
        </section>

        <footer>
          <span className="love">
            Made with <Icon name="heart" size={14} className="heart" /> by AminMGM
          </span>
          <button className="btn ghost small" onClick={() => void window.meow.openExternal(REPO)}>
            <Icon name="github" size={14} /> GitHub
          </button>
        </footer>
      </div>
    </div>
  )
}

export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'info' : t.kind === 'ok' ? 'check' : 'sparkle'} size={16} />
          <span>{t.text}</span>
          {t.action && (
            <button className="btn ghost small" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
