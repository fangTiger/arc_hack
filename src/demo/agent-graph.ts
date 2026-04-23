import type { ExtractionEntity, ExtractionRelation, ExtractionRequest, ExtractionOperation } from '../domain/extraction/types.js';
import type { Price } from '../domain/payment/types.js';

export type AgentGraphNodeType = ExtractionEntity['type'] | 'unknown';

export type AgentGraphNode = {
  id: string;
  label: string;
  type: AgentGraphNodeType;
  color: string;
  x: number;
  y: number;
};

export type AgentGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  provenance: 'original' | 'derived';
};

export type AgentSessionRun = {
  requestId: string;
  operation: ExtractionOperation;
  price: Price;
  paymentTransaction: string;
  paymentAmount: string;
  paymentNetwork: string;
  paymentPayer: string;
  payloadHash: `0x${string}`;
  receiptTxHash?: `0x${string}`;
};

export type AgentSession = {
  status: 'completed';
  sessionId: string;
  createdAt: string;
  source: ExtractionRequest;
  summary: string;
  entities: ExtractionEntity[];
  relations: ExtractionRelation[];
  runs: AgentSessionRun[];
  graph: {
    nodes: AgentGraphNode[];
    edges: AgentGraphEdge[];
  };
  totals: {
    totalPrice: Price;
    successfulRuns: number;
  };
};

const NODE_COLOR_BY_TYPE: Record<AgentGraphNodeType, string> = {
  organization: '#0f766e',
  person: '#2563eb',
  topic: '#d97706',
  unknown: '#6b7280'
};

const addNode = (nodes: Map<string, AgentGraphNodeType>, id: string, type: AgentGraphNodeType) => {
  const existing = nodes.get(id);

  if (!existing) {
    nodes.set(id, type);
    return;
  }

  if (existing === 'unknown' && type !== 'unknown') {
    nodes.set(id, type);
  }
};

const buildOriginalEdges = (relations: ExtractionRelation[]): AgentGraphEdge[] =>
  relations.map((relation) => ({
    id: `${relation.source}:${relation.relation}:${relation.target}`,
    source: relation.source,
    target: relation.target,
    label: relation.relation,
    provenance: 'original'
  }));

const buildDerivedEdges = (nodeIds: string[]): AgentGraphEdge[] => {
  if (nodeIds.length <= 1) {
    return [];
  }

  const rootId = nodeIds[0];

  return nodeIds.slice(1, 4).map((targetId) => ({
    id: `${rootId}:derived:提到:${targetId}`,
    source: rootId,
    target: targetId,
    label: '提到',
    provenance: 'derived'
  }));
};

export const buildAgentGraph = (entities: ExtractionEntity[], relations: ExtractionRelation[]) => {
  const nodeTypes = new Map<string, AgentGraphNodeType>();

  for (const entity of entities) {
    addNode(nodeTypes, entity.name, entity.type);
  }

  for (const relation of relations) {
    addNode(nodeTypes, relation.source, nodeTypes.get(relation.source) ?? 'unknown');
    addNode(nodeTypes, relation.target, nodeTypes.get(relation.target) ?? 'unknown');
  }

  const originalEdges = buildOriginalEdges(relations);
  const hasOriginalEdges = originalEdges.length > 0;
  const connectedNodeIds = hasOriginalEdges
    ? new Set(originalEdges.flatMap((edge) => [edge.source, edge.target]))
    : new Set(nodeTypes.keys());
  const nodeIds = [...nodeTypes.keys()].filter((id) => connectedNodeIds.has(id));
  const radius = 170;
  const centerX = 240;
  const centerY = 220;
  const nodes = nodeIds.map((id, index) => {
    const angle = nodeIds.length <= 1 ? 0 : (Math.PI * 2 * index) / nodeIds.length;
    const type = nodeTypes.get(id) ?? 'unknown';

    return {
      id,
      label: id,
      type,
      color: NODE_COLOR_BY_TYPE[type],
      x: nodeIds.length <= 1 ? centerX : Math.round(centerX + radius * Math.cos(angle)),
      y: nodeIds.length <= 1 ? centerY : Math.round(centerY + radius * Math.sin(angle))
    } satisfies AgentGraphNode;
  });

  const edges = hasOriginalEdges ? originalEdges : buildDerivedEdges(nodeIds);

  return { nodes, edges };
};
