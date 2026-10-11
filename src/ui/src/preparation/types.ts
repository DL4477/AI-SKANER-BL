import type { AnalysisPage } from "../analysis/types";

export type Point = [number, number];
export type Polygon = Point[];
export type Box = [number, number, number, number];
export type Reading = {
  text: string;
  engine: "pdf" | "rapidocr" | "tesseract";
  confidence: number | null;
  rotation: number;
};
export type TextRegion = {
  id: string;
  page: number;
  polygon: Polygon;
  readings: Reading[];
  fragmentIds: string[];
  reasons: string[];
};
export type Fragment = AnalysisPage & {
  id: string;
  bbox: Box;
  dpi: number;
  rotation: number;
  purpose: "tile" | "review";
};
export type PreparedDrawing = {
  version: "preparation-1";
  documentId: string;
  checksum: string;
  settingsKey: string;
  pages: AnalysisPage[];
  pageInfo: {
    page: number;
    width: number;
    height: number;
    rotation: number;
    textLayer: "present" | "empty" | "error";
  }[];
  fragments: Fragment[];
  regions: TextRegion[];
  warnings: string[];
  engines: Record<string, string>;
  elapsedMs: number;
  status: "preparing" | "complete" | "failed" | "cancelled";
  coverage: {
    pagesTotal: number;
    pagesCompleted: number;
    tilesCompleted: number;
    reviewsCompleted: number;
    unfinishedPages: number[];
    errors: string[];
  };
};
export type OcrResult = {
  regions: {
    polygon: Polygon;
    text: string;
    confidence: number | null;
    engine: "rapidocr" | "tesseract";
    rotation: number;
  }[];
  engines: Record<string, string>;
};
