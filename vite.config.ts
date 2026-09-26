import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createApi, createStore } from './server/api.ts'

// The API runs inside the dev server, so `npm run dev` is the whole app. Sets are kept in
// .data/sets.json so restarting the dev server doesn't lose them.
const api = (): Plugin => ({
  name: 'second-opinion-api',
  configureServer(server) {
    server.middlewares.use(createApi(createStore('.data/sets.json')))
  },
})

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so a build works from a project subpath (GitHub Pages) as well as root.
  base: './',
  plugins: [react(), tailwindcss(), api()],
  server: {
    port: 3532,
    strictPort: true,
  },
})
