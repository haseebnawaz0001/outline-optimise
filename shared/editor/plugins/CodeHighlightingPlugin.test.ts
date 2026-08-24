import {
  createEditorState,
  doc,
  p as paragraph,
  codeBlock,
} from "@shared/test/editor";
import type { EditorState, Plugin } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  highlight: vi.fn(() => [
    {
      type: "element",
      properties: { className: ["token"] },
      children: [{ type: "text", value: "x" }],
    },
  ]),
}));

vi.mock("refractor/core", () => ({
  __esModule: true,
  default: {
    registered: () => true,
    register: vi.fn(),
    highlight: mocks.highlight,
  },
}));

// Imported after the mock registration so getRefractor resolves the mock.
import { CodeHighlighting, getRefractor } from "./CodeHighlightingPlugin";

/**
 * Counts the live decorations produced for the given state.
 *
 * @param state Editor state containing the plugin.
 * @param plugin The highlighting plugin under test.
 * @returns Number of decorations in the set.
 */
function countDecorations(state: EditorState, plugin: Plugin<DecorationSet>) {
  const set = plugin.getState(state);
  return set ? set.find(0, state.doc.content.size).length : 0;
}

describe("CodeHighlightingPlugin", () => {
  beforeEach(async () => {
    // Prime the module-level refractor instance (normally loaded by the
    // plugin's view hook) so highlighting runs synchronously in tests.
    await getRefractor();
    mocks.highlight.mockClear();
  });

  it("highlights each block once and reuses the cache when positions shift", () => {
    const plugin = CodeHighlighting({ name: "code_block" });
    let state = createEditorState(
      doc([
        codeBlock("const a = 1;", "javascript"),
        paragraph("middle"),
        codeBlock("const b = 2;", "javascript"),
      ]),
      [plugin]
    );

    // First triggering transaction rebuilds both blocks.
    state = state.apply(
      state.tr.setMeta("codeHighlighting", { langLoaded: true })
    );
    expect(mocks.highlight).toHaveBeenCalledTimes(2);
    const afterFirst = countDecorations(state, plugin);
    expect(afterFirst).toBeGreaterThan(0);

    // An unrelated edit upstream shifts both blocks; the identity-keyed
    // cache must serve both without re-highlighting.
    mocks.highlight.mockClear();
    state = state.apply(state.tr.insert(0, paragraph("intro")));
    expect(mocks.highlight).not.toHaveBeenCalled();
    expect(countDecorations(state, plugin)).toBe(afterFirst);
  });

  it("re-highlights only the block whose content changed", () => {
    const plugin = CodeHighlighting({ name: "code_block" });
    const first = codeBlock("const a = 1;", "javascript");
    let state = createEditorState(
      doc([first, codeBlock("const b = 2;", "javascript")]),
      [plugin]
    );
    state = state.apply(
      state.tr.setMeta("codeHighlighting", { langLoaded: true })
    );
    expect(mocks.highlight).toHaveBeenCalledTimes(2);

    mocks.highlight.mockClear();

    // Edit inside the second block: its node identity changes while the
    // first block's is untouched.
    state = state.apply(state.tr.insertText("x", first.nodeSize + 1));
    expect(mocks.highlight).toHaveBeenCalledTimes(1);
  });

  it("maps decorations on transactions that need no rebuild", () => {
    const plugin = CodeHighlighting({ name: "code_block" });
    let state = createEditorState(doc([codeBlock("a", "javascript")]), [
      plugin,
    ]);
    state = state.apply(
      state.tr.setMeta("codeHighlighting", { langLoaded: true })
    );
    const before = countDecorations(state, plugin);
    expect(before).toBeGreaterThan(0);

    mocks.highlight.mockClear();

    // Selection-only transaction maps instead of rebuilding.
    state = state.apply(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
    );
    expect(mocks.highlight).not.toHaveBeenCalled();
    expect(countDecorations(state, plugin)).toBe(before);
  });
});
