# Cortex Neural Network - Brain-like Memory Processing

**Architecture**: Neuron-based memory nodes with synaptic connections, dream consolidation, and Hebbian learning.

## Core Concepts

| Brain Component | Cortex Equivalent | Purpose |
|-----------------|-------------------|---------|
| **Neuron** | `NeuronNode` | Individual memory unit with activation level |
| **Synapse** | `weights` | Weighted connections between neurons |
| **Firing** | `activationLevel >= threshold` | Active memory retrieval |
| **Decay** | `decay()` | Natural forgetting over time |
| **Hebbian Learning** | `connectTo()` | Cells that fire together wire together |
| **REM Sleep** | `dreamConsolidate()` | Pattern synthesis and connection pruning |
| **Synaptic Pruning** | `pruneWeakestConnections()` | Remove weak connections |

## Neural Network Properties

```javascript
{
  activationLevel: 0.0-1.0,    // Current firing state
  threshold: 0.3,              // Fire threshold
  strength: 1.0-2.0,           // Node strength (grows with use)
  age: number,                 // Days since creation
  weights: {                   // Synaptic connections
    targetId: {
      weight: 0.0-1.0,
      relationType: 'semantic' | 'temporal' | 'content' | 'co-activated',
      usageCount: number
    }
  }
}
```

## Connection Types

| Type | Description | Weight Boost |
|------|-------------|--------------|
| `semantic` | Shared tags/concepts | +0.2 per tag |
| `content` | Keyword overlap | +0.05 per keyword |
| `temporal` | Created within 7 days | +0.1 |
| `co-activated` | Fired together in dream | +0.7 |

## Dream Consolidation Process

```
Phase 1: Decay → Apply natural forgetting to all neurons
Phase 2: Co-activation Analysis → Find neurons that fire together
Phase 3: Connection Strengthening → Boost within-group connections
Phase 4: Synaptic Pruning → Remove weak connections (<0.05)
Phase 5: Pattern Synthesis → Create abstract patterns from clusters
Phase 6: Entity Extraction → Create entity nodes from frequent tags
```

## CLI Usage

```bash
# Full neural processing pipeline
node bin/cortex-neural-cli.cjs

# Output:
# - Neural network saved to ~/.claude/memory/neural/
# - Obsidian vault with graph relations
# - Dream log with synthesized patterns
```

## Obsidian Integration

The neural network exports to Obsidian with:
- **Entity Nodes** (`00 Nodes/`) - Extracted concepts
- **Memory Records** (`10 Records/`) - Individual neurons
- **Connection Index** (`Neural Index.md`) - Graph topology
- **Pattern Notes** - Synthesized dream patterns

## API

```javascript
const { NeuralNetwork } = require('./core/neural-network.cjs');

const network = new NeuralNetwork({ basePath: '~/.claude/memory/neural' });
await network.initialize();

// Add memory as neuron
network.addNeuron(memoryRecord);

// Activate and propagate
network.activateNeuron('neuron:id', 1.0);

// Query by similarity
const results = network.query('authentication patterns', { limit: 20 });

// Dream consolidation
await network.dreamConsolidate();

// Stats
const stats = network.getStats();
// { nodeCount, connectionCount, firingNodes, avgActivation, dreamCount }
```

## Files

| File | Purpose |
|------|---------|
| `core/neural-network.cjs` | Neural network implementation |
| `bin/cortex-neural-cli.cjs` | Interactive CLI |
| `~/.claude/memory/neural/nodes.json` | Stored neurons |
| `~/.claude/memory/neural/connections.json` | Synaptic connections |
| `~/.claude/memory/neural/dream-log.jsonl` | Dream consolidation history |