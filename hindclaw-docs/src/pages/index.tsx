import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

const features = [
  {
    title: 'Per-Agent Memory Banks',
    description: 'Each agent gets its own memory bank with custom missions, entity labels, dispositions, and directives. Configured via JSON5 files, synced to Hindsight.',
  },
  {
    title: 'Multi-Bank Recall',
    description: 'Agents can read from multiple banks in parallel. A strategic advisor recalls from finance, marketing, and ops banks simultaneously.',
  },
  {
    title: 'Named Retain Strategies',
    description: 'Map Telegram topics to extraction strategies. Strategic conversations get deep analysis, daily chats get lightweight extraction.',
  },
  {
    title: 'Infrastructure as Code',
    description: 'hindclaw plan/apply/import. Declare bank configs in files, diff against server state, apply changes. Like Terraform for memory banks.',
  },
  {
    title: 'Built on Hindsight',
    description: 'Powered by Hindsight — biomimetic memory with semantic, BM25, graph, and temporal retrieval. Facts, entities, observations, mental models.',
  },
  {
    title: 'Server-Side Extensions',
    description: 'Access control, tag injection, and strategy routing via Hindsight extensions. One enforcement point for all clients.',
  },
];

function Feature({title, description}: {title: string; description: string}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md padding-vert--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Pro Hindsight plugin for OpenClaw"
      description="Production-grade Hindsight memory plugin for OpenClaw with per-agent bank configs, multi-bank recall, named strategies, and infrastructure-as-code.">
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {features.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
