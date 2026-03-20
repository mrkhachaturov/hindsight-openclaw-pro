---
sidebar_position: 1
slug: /intro
title: What is hindclaw?
---

# What is hindclaw?

hindclaw is a production-grade [Hindsight](https://hindsight.vectorize.io) memory plugin for [OpenClaw](https://github.com/openclaw/openclaw). It gives your AI agent fleet long-term memory with per-agent configuration, multi-bank recall, named retain strategies, and infrastructure-as-code management.

## Two Dimensions

Every message resolves along two orthogonal axes:

**WHO** -- permissions resolved through 4 layers (global config -> group merge -> bank group override -> bank user override). Not just access flags -- 11 configurable fields at every layer: LLM model, token budget, extraction depth, tag visibility, retention frequency.

**HOW** -- strategy resolved per topic. Each conversation topic routes to a named strategy with its own extraction mission, mode, and entity labels.

```mermaid
graph TD
    MSG["Message: user + bank + topic"] --> PERM["Resolve permissions\nfor THIS user on THIS bank"]
    MSG --> STRAT["Resolve strategy\nfor THIS topic on THIS bank"]
    PERM --> R{"recall?"}
    PERM --> W{"retain?"}
    R -->|true| RECALL["Recall\nbudget, tokens, tag filters"]
    R -->|false| NO_R["No recall"]
    W -->|true| RETAIN["Retain\nroles, tags, LLM model\n+ topic strategy"]
    W -->|false| NO_W["No retain"]
    STRAT --> RETAIN
```

Every combination of **(user x bank x topic)** can produce different behavior.

## Core Features

**Per-agent bank configs** -- each agent gets its own retain mission, entity labels, dispositions, and directives. Configured via JSON5 files, synced to Hindsight via `hindclaw apply`.

**Multi-bank recall** -- agents read from multiple banks in parallel. A strategic advisor recalls from finance, marketing, and ops banks simultaneously.

**Named retain strategies** -- map conversation topics to extraction profiles. Strategic conversations get deep analysis, daily chats get lightweight extraction. Strategies can also be assigned per user group.

**Access control** -- Confluence-style permission model. Users belong to groups. Groups define defaults. Banks override per-group or per-user. Anonymous users blocked by default.

**Infrastructure as Code** -- `hindclaw plan/apply/import`. Declare bank configs in JSON5 files, diff against server state, apply changes. Like Terraform for memory banks.

**Session start context** -- mental models loaded before the first message. No cold start.

**Reflect-on-recall** -- use Hindsight's reflect API instead of raw recall for richer, reasoned responses.

**Multi-server** -- per-agent infrastructure routing. One gateway, multiple Hindsight servers (home, office, local daemon).

## Built on Hindsight

[Hindsight](https://hindsight.vectorize.io) is a biomimetic memory system for AI agents with semantic, BM25, graph, and temporal retrieval. hindclaw is a client that maps OpenClaw concepts (agents, channels, topics, users) onto Hindsight capabilities (banks, strategies, tags, tag_groups).

## Next Steps

- [Installation](./getting-started/installation) -- set up hindsight-embed and install the plugin
- [Bank Configuration](./guides/bank-configs) -- configure your first agent's memory
- [Access Control](./guides/access-control) -- set up multi-user permissions
