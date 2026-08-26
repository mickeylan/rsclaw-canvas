import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

const host = process.env.VITE_DEV_HOST

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    Components({
      dts: false,
      resolvers: [AntDesignVueResolver({ importStyle: false })]
    })
  ],
  clearScreen: false,
  server: {
    host: host || '127.0.0.1',
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'chrome142',
    minify: 'esbuild',
    sourcemap: false
  }
})
