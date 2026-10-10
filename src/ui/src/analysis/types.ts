export type Evidence = {
  page: number;
  description: string;
  bbox: [number, number, number, number] | null;
};
export type Requirement = {
  id: string;
  kind: string;
  raw_text: string;
  value: number | null;
  unit: string | null;
  it_grade: string | null;
  applies_to: string;
  evidence: Evidence[];
};
export type SurfaceAnalysis = {
  id: string;
  name: string;
  type: string;
  orientation: string;
  geometry_parameters: {
    name: string;
    value: number | null;
    unit: string | null;
    designation: string | null;
    basis: "read" | "derived" | "unknown";
    evidence: Evidence[];
  }[];
  boundary_description: string | null;
  local_requirements: Requirement[];
  general_requirement_ids: string[];
  evidence: Evidence[];
  uncertainties: string[];
};
export type DrawingAnalysis = {
  schema_version: "0.1.0-draft";
  status: "needs_review";
  ready_for_3d: false;
  source: { name: string; kind: "pdf" | "demo"; page_count: number };
  drawing_general: {
    part_name: string | null;
    designation: string | null;
    material: string | null;
    units: string | null;
    notes: string[];
    general_requirements: Requirement[];
  };
  surfaces: SurfaceAnalysis[];
  questions: string[];
  summary: string;
};
export type AnalysisReport = {
  data: DrawingAnalysis;
  elapsedMs: number;
  totalTokens: number | null;
  model: string;
};
export type AnalysisPage = {
  page: number;
  width: number;
  height: number;
  image: string;
};
export type DrawingSource = { name: string; url: string; kind: "pdf" | "demo" };
