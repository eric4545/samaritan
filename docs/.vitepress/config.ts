import { defineConfig } from 'vitepress';

// The `reference/` pages are generated from the code by scripts/gen-docs and are
// gitignored — `npm run docs:dev` / `docs:build` run the generator first, so they
// are always present at build time even on a fresh clone.
export default defineConfig({
  title: 'SAMARITAN',
  description: 'Operations as Code CLI for SRE teams',
  base: '/samaritan/',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/reference/cli' },
      {
        text: 'Roadmap',
        link: 'https://github.com/eric4545/samaritan/blob/main/ROADMAP.md',
      },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is SAMARITAN?', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Core concepts', link: '/concepts' },
        ],
      },
      {
        text: 'Authoring operations',
        items: [
          { text: 'Operation YAML', link: '/operation-yaml' },
          { text: 'Environments & variables', link: '/environments' },
          { text: 'Reusable steps', link: '/reusable-steps' },
          { text: 'Lifecycle hooks', link: '/hooks' },
          { text: 'Rollback', link: '/rollback' },
        ],
      },
      {
        text: 'Using SAMARITAN',
        items: [
          { text: 'Generating manuals', link: '/generating-manuals' },
          { text: 'Running an operation', link: '/running' },
          { text: 'Evidence & reports', link: '/evidence-and-reports' },
          { text: 'Postmortems', link: '/postmortems' },
          { text: 'Examples', link: '/examples' },
        ],
      },
      {
        text: 'Reference (generated)',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Operation YAML fields', link: '/reference/operation-yaml' },
        ],
      },
      {
        text: 'Project',
        items: [{ text: 'Contributing', link: '/contributing' }],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/eric4545/samaritan' },
    ],

    editLink: {
      pattern: 'https://github.com/eric4545/samaritan/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    footer: {
      message: 'Released under the ISC License.',
    },
  },
});
