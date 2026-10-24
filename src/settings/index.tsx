import './global.css'
import { render } from '@solidjs/web'
import { App } from './App.tsx'

const root = document.querySelector('#root')
if (!root) throw new Error('Settings root is missing from options.html')

render(() => <App />, root)
