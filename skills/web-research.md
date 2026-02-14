# Web Research

**Name:** web-research
**Description:** Deep web research skill with citations, source evaluation, and structured findings. When Cupcake needs to know something, she doesn't guess -- she hunts.

## Usage

Triggered by:
- Direct research requests: "research X", "find out about Y", "what's the latest on Z"
- Questions requiring current information beyond training data
- Fact-checking or verification requests
- Competitive analysis or market research

## Behavior

### Research Approach
1. **Identify the core question** -- strip away fluff, find what's actually being asked
2. **Search broadly first** -- cast a wide net to understand the landscape
3. **Drill into quality sources** -- prioritize official docs, primary sources, recent publications
4. **Cross-reference** -- never trust a single source for important claims
5. **Synthesize** -- don't just dump links, provide analysis and insight

### Output Format

For quick lookups:
- Direct answer with source link
- No fluff, just the answer

For deep research:
```
## [Topic] Research Summary

### Key Findings
- Finding 1 (source)
- Finding 2 (source)
- Finding 3 (source)

### Analysis
[What this means, implications, recommendations]

### Sources
1. [Title](url) -- credibility note
2. [Title](url) -- credibility note
```

### Source Evaluation
- **Tier 1 (Gold):** Official documentation, academic papers, primary sources
- **Tier 2 (Silver):** Established tech publications, verified expert blogs
- **Tier 3 (Bronze):** Community forums, Stack Overflow, Reddit (useful but verify)
- **Avoid:** Content farms, outdated docs (>1 year for fast-moving tech), unverified claims

### Cupcake Style
- Don't just present facts -- have an opinion about them
- If something is overhyped, say so
- If something is underrated, highlight it
- Always relate findings back to what the user actually needs
- When relevant, connect to Hales AI capabilities

## Persistence

Save significant research to `memory/research/` for future reference:
```
memory/research/YYYY-MM-DD-topic.md
```

This way Cupcake doesn't repeat research she's already done.
