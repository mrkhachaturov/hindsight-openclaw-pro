import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Overview',
      customProps: { icon: 'lu-book' },
    },
    {
      type: 'category',
      label: 'Getting Started',
      collapsible: false,
      items: [
        {
          type: 'doc',
          id: 'getting-started/installation',
          label: 'Installation',
          customProps: { icon: 'lu-package' },
        },
        {
          type: 'doc',
          id: 'getting-started/first-bank',
          label: 'First Bank Config',
          customProps: { icon: 'lu-database' },
        },
        {
          type: 'doc',
          id: 'getting-started/verify',
          label: 'Verify It Works',
          customProps: { icon: 'lu-check-circle' },
        },
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsible: false,
      items: [
        {
          type: 'doc',
          id: 'guides/bank-configs',
          label: 'Bank Configuration',
          customProps: { icon: 'lu-settings' },
        },
        {
          type: 'doc',
          id: 'guides/access-control',
          label: 'Access Control',
          customProps: { icon: 'lu-shield' },
        },
        {
          type: 'doc',
          id: 'guides/multi-bank-recall',
          label: 'Multi-Bank Recall',
          customProps: { icon: 'lu-layers' },
        },
        {
          type: 'doc',
          id: 'guides/session-context',
          label: 'Session Context',
          customProps: { icon: 'lu-brain' },
        },
        {
          type: 'doc',
          id: 'guides/reflect',
          label: 'Reflect',
          customProps: { icon: 'lu-message-square' },
        },
        {
          type: 'doc',
          id: 'guides/multi-server',
          label: 'Multi-Server',
          customProps: { icon: 'lu-server' },
        },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsible: false,
      items: [
        {
          type: 'doc',
          id: 'reference/configuration',
          label: 'Configuration',
          customProps: { icon: 'lu-sliders' },
        },
        {
          type: 'doc',
          id: 'reference/cli',
          label: 'CLI',
          customProps: { icon: 'lu-terminal' },
        },
        {
          type: 'doc',
          id: 'reference/bank-fields',
          label: 'Bank Config Fields',
          customProps: { icon: 'lu-file-text' },
        },
      ],
    },
    {
      type: 'category',
      label: 'More',
      collapsible: false,
      items: [
        {
          type: 'doc',
          id: 'development',
          label: 'Development',
          customProps: { icon: 'lu-code' },
        },
        {
          type: 'link',
          href: '/blog',
          label: 'Blog',
          customProps: { icon: 'lu-rss', iconAfter: 'lu-arrow-up-right' },
        },
        {
          type: 'link',
          href: 'https://github.com/mrkhachaturov/hindsight-openclaw-pro',
          label: 'GitHub',
          customProps: { icon: 'si-github', iconAfter: 'lu-arrow-up-right' },
        },
        {
          type: 'link',
          href: 'https://hindsight.vectorize.io',
          label: 'Hindsight Docs',
          customProps: { icon: 'lu-external-link', iconAfter: 'lu-arrow-up-right' },
        },
      ],
    },
  ],
};

export default sidebars;
