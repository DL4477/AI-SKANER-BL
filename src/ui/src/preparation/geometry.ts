import type { Box, Point, Polygon, TextRegion } from "./types";

export const SETTINGS_KEY =
  "pdfjs-300dpi-2000px-overlap15-native-text-no-ocr-v2";
export function tileBoxes(
  width: number,
  height: number,
  size = 2000,
  overlap = 0.15,
): Box[] {
  const starts = (length: number) => {
    const out = [0];
    while (out.at(-1)! + size < length)
      out.push(
        Math.min(out.at(-1)! + Math.floor(size * (1 - overlap)), length - size),
      );
    return out;
  };
  return starts(height).flatMap((y) =>
    starts(width).map(
      (x) =>
        [x, y, Math.min(x + size, width), Math.min(y + size, height)] as Box,
    ),
  );
}
export function bounds(points: Polygon): Box {
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
export function boxPolygon(b: Box): Polygon {
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
}
export function pagePolygon(
  points: Polygon,
  box: Box,
  width: number,
  height: number,
): Polygon {
  return points.map(
    ([x, y]) =>
      [
        Math.max(0, Math.min(1, box[0] + (x / width) * (box[2] - box[0]))),
        Math.max(0, Math.min(1, box[1] + (y / height) * (box[3] - box[1]))),
      ] as Point,
  );
}
export function overlap(a: Box, b: Box): number {
  const intersection =
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (
    intersection /
    Math.max(
      1e-12,
      Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])),
    )
  );
}
export function comparable(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}
export function mergeRegion(regions: TextRegion[], next: TextRegion) {
  const b = bounds(next.polygon);
  const match = regions.find((r) => {
    if (r.page !== next.page) return false;
    const a = bounds(r.polygon);
    const ratio =
      ((a[2] - a[0]) * (a[3] - a[1])) /
      Math.max(1e-12, (b[2] - b[0]) * (b[3] - b[1]));
    return ratio > 0.35 && ratio < 2.85 && overlap(a, b) >= 0.7;
  });
  if (!match) {
    regions.push(next);
    return;
  }
  for (const reading of next.readings) {
    if (
      !match.readings.some(
        (r) =>
          r.engine === reading.engine &&
          r.rotation === reading.rotation &&
          comparable(r.text) === comparable(reading.text),
      )
    )
      match.readings.push(reading);
  }
  match.fragmentIds = [...new Set([...match.fragmentIds, ...next.fragmentIds])];
  match.reasons = [...new Set([...match.reasons, ...next.reasons])];
  if (
    new Set(match.readings.map((r) => comparable(r.text))).size > 1 &&
    !match.reasons.includes("Разные варианты чтения")
  )
    match.reasons.push("Разные варианты чтения");
}
export function expandBox(b: Box, marginX: number, marginY: number): Box {
  return [
    Math.max(0, b[0] - marginX),
    Math.max(0, b[1] - marginY),
    Math.min(1, b[2] + marginX),
    Math.min(1, b[3] + marginY),
  ];
}
