/// DEV-ONLY preview without Supabase: `npm run dev:mock`
/// Replaces src/lib/supabase.ts with dev/mock/supabase.ts (fake data). Not used by `npm run build`.
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/lib\/supabase$/, replacement: path.resolve(import.meta.dirname, './dev/mock/supabase.ts') },
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
