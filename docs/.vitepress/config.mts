import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/MeshtasticForeman/',
  vite: {
    ssr: {
      noExternal: ['vitepress-carbon'],
    },
  },
  title: 'MeshtasticForeman',
  description: 'Self-hosted dashboard and API for Meshtastic mesh networks',
  appearance: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap' }],
  ],
  themeConfig: {
    logo: '/wolf.png',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api' },
      { text: '⚠ Meshtastic Fork', link: 'https://meshtastic.org' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Deployment', link: '/guide/deployment' },
            { text: 'Roadmap', link: '/guide/roadmap' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Full API Contract', link: '/api' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SupremeLordCommander/MeshtasticForeman' }
    ],
    footer: {
      message: 'Released under MIT License',
      copyright: 'Copyright © 2026 SupremeLordCommander'
    },
  },
})