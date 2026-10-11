export type Evidence = {
  page: number;
  description: string;
  bbox: [number, number, number, number] | null;
};
export type SourceFocus = Evidence & { token: number };
export type Observation = {
  id: string;
  raw_text: string;
  kind: string;
  view_id: string | null;
  alternatives: string[];
  evidence: Evidence[];
};
export type Dimension = {
  id: string;
  observation_ids: string[];
  name: string;
  value: number | null;
  unit: string | null;
  designation: string | null;
  basis: "read" | "derived" | "assumed" | "unknown";
  role: string;
  axis: string;
  reference_description: string;
  derived_from: { dimension_id: string; coefficient: number }[];
  derivation_note: string | null;
};
export type Requirement = {
  dimension_ids: string[];
  id: string;
  kind: string;
  raw_text: string;
  value: number | null;
  unit: string | null;
  it_grade: string | null;
  observation_ids: string[];
  scope: "general" | "local" | "unknown";
  scope_description: string;
};
export type Binding = {
  target_evidence: Evidence[];
  id: string;
  fact_id: string;
  surface_ids: string[];
  property: string;
  status: "proposed" | "disputed";
  rationale: string;
  alternatives: string[];
};
export type SurfaceAnalysis = {
  physical_role: string;
  id: string;
  name: string;
  type: string;
  orientation: string;
  boundary_description: string | null;
  evidence: Evidence[];
  uncertainties: string[];
};
export type LocalCheck = {
  code: string;
  severity: "error" | "warning" | "not_checkable" | "info";
  entity_ids: string[];
  message: string;
};
export type DrawingAnalysis = {
  schema_version: "0.2.0-draft";
  status: "needs_review";
  ready_for_3d: false;
  source: { name: string; kind: "pdf" | "demo"; page_count: number };
  drawing_general: {
    part_name: string | null;
    designation: string | null;
    material: string | null;
    units: string | null;
    notes: string[];
    general_requirement_ids: string[];
  };
  views: {
    id: string;
    label: string;
    kind: string;
    description: string;
    evidence: Evidence[];
  }[];
  observations: Observation[];
  dimensions: Dimension[];
  requirements: Requirement[];
  bindings: Binding[];
  dimension_chains: {
    id: string;
    total_dimension_id: string;
    terms: { dimension_id: string; coefficient: number }[];
    description: string;
  }[];
  surfaces: SurfaceAnalysis[];
  questions: string[];
  summary: string;
  validation: { engine_version: string; checks: LocalCheck[]; scope: string };
};
export type AnalysisReport = {
  data: DrawingAnalysis;
  elapsedMs: number;
  totalTokens: number | null;
  model: string;
};
export type AnalysisProgress = {
  phase: "connecting" | "waiting" | "thinking" | "receiving" | "validating";
  contentBytes: number;
};
export type AnalysisPage = {
  page: number;
  width: number;
  height: number;
  image: string;
};
export type DrawingSource = { name: string; url: string; kind: "pdf" | "demo" };
