# Changelog

All notable changes to the Cortex AI memory engine will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-04-12

### Added
- **Neural Topography (Cortex Morphology) Framework:** Completely reimagined memory storage replacing temporal flat files with spatial, biological geometric mappings (`Lobe / Region / Cluster`) for all memory inferences.
- **Anthropic Core Engine:** Abandoned generic regex parsers for direct `claude-3-5-sonnet` tool-call integration (`create_cortex_topology_nodes`) processing all system ingestions autonomously.
- **Local Whisper Pipeline:** Hardended the underlying ingestion endpoints replacing dummy text simulators with an entirely off-grid `@xenova/transformers` audio ingestion pipeline for processing multi-modal user input securely.
- **TUI Dashboard:** Shipped `@inquirer/prompts` Terminal UI (`cortex-tui`) to cleanly handle all local maintenance operations like Vault Compilation, Search, Migrations, and Stats.
- **API Server Complete Endpoints:** Instantiated all promised REST mappings (`/api/query`, `/api/memories`) into the network layer to natively assist standalone AI Dashboard systems connecting to Cortex.
- **Dynamic Vault Renderer:** Converted Obsidian exporter (`00 Welcome.md`) to a glassmorphism dynamic template loaded with `-webkit-linear-gradient` anatomy definitions, replacing static documentation rendering natively in the Graph UI.

### Changed
- Refactored `ExtractionEngine` away from literal keyword chunking towards complete semantic comprehension via `Anthropic` client mapping.
- Memory Palace (Wing/Hall) models eliminated in favor of literal Cerebral definitions.
- Renamed the fallback repository bins for broader execution safety.

### Fixed
- Fixed critical test dependencies attempting to execute network functions during mock evaluations natively in `tests/test-hooks.cjs`.
- Solved recursive directory bugs natively inside the `obsidian-vault.cjs` exporter.