import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'hindclaw',
  tagline: 'Pro Hindsight plugin for OpenClaw',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  markdown: {
    mermaid: true,
  },

  url: 'https://hindclaw.pro',
  baseUrl: '/',

  organizationName: 'mrkhachaturov',
  projectName: 'hindsight-openclaw-pro',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: 'anonymous',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap',
        media: 'print',
        onload: "this.media='all'",
      },
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/mrkhachaturov/hindsight-openclaw-pro/tree/main/hindclaw-docs/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl:
            'https://github.com/mrkhachaturov/hindsight-openclaw-pro/tree/main/hindclaw-docs/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        docsRouteBasePath: '/docs',
        indexBlog: true,
        blogRouteBasePath: '/blog',
        highlightSearchTermsOnTargetPage: false,
      },
    ],
  ],

  themeConfig: {
    image: 'img/hindclaw-logo.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'hindclaw',
      logo: {
        alt: 'hindclaw Logo',
        src: 'img/hindclaw-logo.png',
        style: {height: '32px'},
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/mrkhachaturov/hindsight-openclaw-pro',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/hindclaw',
          label: 'npm',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord (Hindsight)',
              href: 'https://discord.gg/hindsight',
            },
            {
              label: 'GitHub Issues',
              href: 'https://github.com/mrkhachaturov/hindsight-openclaw-pro/issues',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'Hindsight',
              href: 'https://hindsight.vectorize.io',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Ruben Khachaturov. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json5', 'json', 'python', 'rust', 'hcl', 'sql'],
    },
    mermaid: {
      theme: {
        light: 'base',
        dark: 'base',
      },
      options: {
        themeVariables: {
          // Teal primary for nodes
          primaryColor: '#00BCD4',
          primaryTextColor: '#ffffff',
          primaryBorderColor: '#00838F',
          // Orange accent for edges/clusters
          secondaryColor: '#E64A19',
          secondaryTextColor: '#ffffff',
          secondaryBorderColor: '#BF360C',
          // Tertiary
          tertiaryColor: '#E0F7FA',
          tertiaryTextColor: '#1A1A2E',
          // Lines and edges - teal
          lineColor: '#00BCD4',
          // Text
          textColor: '#1A1A2E',
          // Node specific - teal
          nodeBkg: '#00BCD4',
          nodeTextColor: '#ffffff',
          nodeBorder: '#00838F',
          // Main background
          mainBkg: '#00BCD4',
          // Clusters/subgraphs - teal tint
          clusterBkg: 'rgba(0, 188, 212, 0.08)',
          clusterBorder: '#00BCD4',
          // Labels
          edgeLabelBackground: 'transparent',
          labelBackground: 'transparent',
          // Font - Inter to match body text
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        },
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
