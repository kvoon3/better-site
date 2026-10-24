import * as stylex from '@stylexjs/stylex'
import { tokens } from './theme.stylex.ts'

export const darkTheme = stylex.createTheme(tokens, {
  bg: '#101012',
  surface: '#18181b',
  surfaceRaised: '#1f1f23',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  faint: '#8b8b93',
  border: '#2a2a2f',
  borderStrong: '#3f3f46',
  accent: '#86efac',
  accentHover: '#bbf7d0',
  accentSoft: 'rgba(134, 239, 172, 0.14)',
  onAccent: '#06210f',
  danger: '#fca5a5',
  dangerSoft: 'rgba(252, 165, 165, 0.14)',
  code: '#242428',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.32), 0 18px 48px rgba(0, 0, 0, 0.42)',
  focusRing: '0 0 0 3px rgba(134, 239, 172, 0.28)',
})
