import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.heroContent}>
          <img
            src="/img/hindclaw-hero.png"
            alt="HindClaw"
            className={styles.heroLogo}
          />
          <Heading as="h1" className={styles.heroTitle}>
            Pro Hindsight Plugin for OpenClaw
          </Heading>
          <p className={styles.heroSubtitle}>
            Per-agent memory banks. Multi-bank recall. Named strategies.
            Server-side access control. Infrastructure as code.
          </p>
          <div className={styles.heroButtons}>
            <Link
              className={clsx('button button--lg', styles.heroPrimary)}
              to="/docs/intro">
              Get Started
            </Link>
            <Link
              className={clsx('button button--lg', styles.heroSecondary)}
              href="https://github.com/mrkhachaturov/hindsight-openclaw-pro">
              GitHub
            </Link>
          </div>
          <div className={styles.heroInstall}>
            <code>openclaw plugins install hindclaw</code>
          </div>
        </div>
      </div>
      <div className={styles.heroGlow} />
    </header>
  );
}

const features = [
  {
    title: 'Per-Agent Memory Banks',
    description: 'Each agent gets its own memory bank with custom missions, entity labels, dispositions, and directives. Configured via JSON5 files, synced to Hindsight.',
    icon: '/img/icons/database.svg',
  },
  {
    title: 'Multi-Bank Recall',
    description: 'Agents can read from multiple banks in parallel. A strategic advisor recalls from finance, marketing, and ops banks simultaneously.',
    icon: '/img/icons/layers.svg',
  },
  {
    title: 'Named Retain Strategies',
    description: 'Route retain operations through a 5-level strategy cascade: agent, channel, topic, group, user. Most specific scope wins.',
    icon: '/img/icons/target.svg',
  },
  {
    title: 'Infrastructure as Code',
    description: 'hindclaw plan/apply/import. Declare bank configs in files, diff against server state, apply changes. Like Terraform for memory banks.',
    icon: '/img/icons/code.svg',
  },
  {
    title: 'Built on Hindsight',
    description: 'Biomimetic memory with semantic, BM25, graph, and temporal retrieval. Facts, entities, observations, mental models.',
    icon: '/img/icons/brain.svg',
  },
  {
    title: 'Server-Side Access Control',
    description: 'JWT-based auth, per-user tag injection and strategy routing via Hindsight extensions. One enforcement point for all clients.',
    icon: '/img/icons/shield.svg',
  },
];

function Feature({title, description}: {title: string; description: string}) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.featureCard}>
        <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
        <p className={styles.featureDescription}>{description}</p>
      </div>
    </div>
  );
}

function ArchitectureSection() {
  return (
    <section className={styles.architecture}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>How It Works</Heading>
        <div className={styles.architectureGrid}>
          <div className={styles.archStep}>
            <div className={styles.archNumber}>1</div>
            <Heading as="h3" className={styles.archTitle}>Message Arrives</Heading>
            <p>User sends a message via Telegram. OpenClaw gateway routes it to the right agent.</p>
          </div>
          <div className={styles.archStep}>
            <div className={styles.archNumber}>2</div>
            <Heading as="h3" className={styles.archTitle}>Plugin Signs JWT</Heading>
            <p>hindclaw generates a JWT with sender, agent, channel, and topic. No user config needed.</p>
          </div>
          <div className={styles.archStep}>
            <div className={styles.archNumber}>3</div>
            <Heading as="h3" className={styles.archTitle}>Server Resolves</Heading>
            <p>Hindsight extension authenticates, resolves permissions, injects tags and strategy.</p>
          </div>
          <div className={styles.archStep}>
            <div className={styles.archNumber}>4</div>
            <Heading as="h3" className={styles.archTitle}>Memory Operates</Heading>
            <p>Recall returns filtered memories. Retain stores with correct tags. All server-side.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Pro Hindsight plugin for OpenClaw"
      description="Production-grade Hindsight memory plugin for OpenClaw with per-agent bank configs, multi-bank recall, named strategies, server-side access control, and infrastructure-as-code.">
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <Heading as="h2" className={styles.sectionTitle}>Features</Heading>
            <div className="row">
              {features.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
        <ArchitectureSection />
      </main>
    </Layout>
  );
}
