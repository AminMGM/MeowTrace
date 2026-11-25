/// <reference types="vite/client" />
import type { MeowApi } from '@shared/api'

declare global {
  interface Window {
    meow: MeowApi
    meowFiles: { pathFor(file: File): string; e2e: boolean }
    __meow?: Record<string, unknown>
  }
}

export {}
