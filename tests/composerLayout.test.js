import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMPOSER_BORDER_WIDTH,
  MAX_COMPOSER_LINES,
  calculateComposerLayout,
} from "../utils/composerLayout.js";

test("composer grows with measured content through six visible lines", () => {
  const initial = calculateComposerLayout({
    contentHeight: 0,
    fontSize: 16,
    viewportHeight: 800,
  });
  const growing = calculateComposerLayout({
    contentHeight: 96,
    fontSize: 16,
    viewportHeight: 800,
  });

  assert.equal(initial.height, initial.minimumHeight);
  assert.equal(growing.height, 96 + COMPOSER_BORDER_WIDTH * 2);
  assert.equal(growing.scrollEnabled, false);
  assert.equal(
    growing.maximumHeight,
    growing.lineHeight * MAX_COMPOSER_LINES +
      growing.paddingVertical * 2 +
      COMPOSER_BORDER_WIDTH * 2
  );
});

test("composer caps at the smaller line or viewport limit and then scrolls", () => {
  const lineLimited = calculateComposerLayout({
    contentHeight: 500,
    fontSize: 16,
    viewportHeight: 800,
  });
  const viewportLimited = calculateComposerLayout({
    contentHeight: 500,
    fontSize: 16,
    viewportHeight: 200,
  });

  assert.equal(lineLimited.height, lineLimited.maximumHeight);
  assert.equal(lineLimited.scrollEnabled, true);
  assert.equal(viewportLimited.maximumHeight, 70);
  assert.equal(viewportLimited.height, 70);
  assert.equal(viewportLimited.scrollEnabled, true);
});

test("cleared or invalid content returns to a safe one-line height", () => {
  const cleared = calculateComposerLayout({
    contentHeight: Number.NaN,
    fontSize: -1,
    viewportHeight: 0,
  });

  assert.equal(cleared.height, cleared.minimumHeight);
  assert.equal(cleared.scrollEnabled, false);
  assert.equal(cleared.lineHeight, 22);
});

test("composer input never pins an explicit height; native growth uses min/max", () => {
  const source = readFileSync(
    new URL("../components/MessageInput.js", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(source, /height: composerLayout\.height/);
  assert.match(source, /minHeight: composerLayout\.minimumHeight/);
  assert.match(source, /maxHeight: composerLayout\.maximumHeight/);
});
