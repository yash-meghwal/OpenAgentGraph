import type {
  EvaluateNodeResult,
  ExecuteNodeResult,
  GoalPacket,
  GraphContext,
  GraphProjection,
  ProviderLineageSnapshot,
  SemanticNodeSummary,
  ToolCallRecord,
  PlanGraphResult,
} from "@openagentgraph/shared";

export interface AIProvider {
  buildGoalPacket(input: {
    goal: string;
    successCriteria: string[];
    forbiddenScope: string[];
    version: number;
  }): Promise<GoalPacket>;

  planGraph(
    goalPacket: GoalPacket,
    constraints: string | undefined,
    projection?: GraphProjection
  ): Promise<PlanGraphResult>;

  executeNode(
    context: GraphContext,
    workspaceRoot: string,
    onToolCall?: (toolCall: Omit<ToolCallRecord, "id" | "nodeId">) => Promise<void>
  ): Promise<ExecuteNodeResult>;

  summarizeCompletedNode(context: GraphContext): Promise<SemanticNodeSummary>;

  embedRetrievalQuery(input: string): Promise<number[]>;

  evaluateNode(context: GraphContext, rubric: string): Promise<EvaluateNodeResult>;

  describeGraphLineage(input: {
    goalPacket: GoalPacket;
    constraints?: string;
    projection?: GraphProjection;
    fallbackUsed?: boolean;
  }): ProviderLineageSnapshot;

  describeNodeLineage(input: {
    context: GraphContext;
    rubric?: string;
    fallbackUsed?: boolean;
  }): ProviderLineageSnapshot;
}
