import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Oklch = [number, number, number];

function oklchToLinearRgb([L, C, H]: Oklch): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

function luminance(rgb: [number, number, number]) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function over(fg: [number, number, number], bg: [number, number, number], alpha: number) {
  return fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as [number, number, number];
}

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const lightBlock = css.match(/\.light\s*\{([\s\S]*?)\}/)?.[1] ?? "";

function lightToken(name: string): Oklch {
  const match = lightBlock.match(new RegExp(`--${name}:\\s*oklch\\(([^)]+)\\)`));
  if (!match?.[1]) throw new Error(`Missing oklch token --${name} in .light`);
  return match[1].trim().split(/\s+/).map(Number) as Oklch;
}

describe("light-mode text tokens", () => {
  const card = oklchToLinearRgb(lightToken("card"));

  it.each([
    ["accent", "coral"],
    ["warning", "amber/gold"],
  ])("%s (%s) reaches 4.5:1 on the light card", (token) => {
    const color = oklchToLinearRgb(lightToken(token));
    expect(contrast(color, card)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([["accent"], ["warning"]])("%s stays legible on its 15%% badge tint", (token) => {
    const color = oklchToLinearRgb(lightToken(token));
    expect(contrast(color, over(color, card, 0.15))).toBeGreaterThanOrEqual(4.5);
  });
});
