const DEFAULT_FONT_SIZE = 16;

export const MAX_COMPOSER_LINES = 6;
export const MAX_COMPOSER_VIEWPORT_RATIO = 0.35;
export const COMPOSER_BORDER_WIDTH = 1;

function positiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

export function calculateComposerLayout({
  contentHeight,
  fontSize,
  viewportHeight,
} = {}) {
  const safeFontSize = positiveNumber(fontSize, DEFAULT_FONT_SIZE);
  const lineHeight = Math.ceil(safeFontSize * 1.35);
  const paddingVertical = Math.ceil(safeFontSize * 0.5);
  const borderHeight = COMPOSER_BORDER_WIDTH * 2;
  const minimumContentHeight = lineHeight + paddingVertical * 2;
  const minimumHeight = minimumContentHeight + borderHeight;
  const lineLimitHeight =
    lineHeight * MAX_COMPOSER_LINES + paddingVertical * 2 + borderHeight;
  const safeViewportHeight = positiveNumber(viewportHeight, null);
  const viewportLimit = safeViewportHeight
    ? Math.floor(safeViewportHeight * MAX_COMPOSER_VIEWPORT_RATIO)
    : lineLimitHeight;
  const maximumHeight = Math.max(
    minimumHeight,
    Math.min(lineLimitHeight, viewportLimit)
  );
  const measuredHeight =
    Math.ceil(positiveNumber(contentHeight, minimumContentHeight)) +
    borderHeight;

  return {
    height: Math.min(maximumHeight, Math.max(minimumHeight, measuredHeight)),
    lineHeight,
    maximumHeight,
    minimumHeight,
    paddingVertical,
    scrollEnabled: measuredHeight > maximumHeight,
  };
}
