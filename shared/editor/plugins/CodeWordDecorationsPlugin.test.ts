import {
  createEditorState,
  doc,
  p as paragraph,
  schema,
} from "@shared/test/editor";
import type { Node } from "prosemirror-model";
import type { EditorState, Plugin } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { codeWordDecorations } from "./CodeWordDecorationsPlugin";

/**
 * Builds a paragraph mixing plain and inline-code text segments.
 *
 * @param parts Tuples of text and whether the segment carries code_inline.
 * @returns The paragraph node.
 */
function mixedParagraph(parts: Array<[string, boolean]>): Node {
  return schema.nodes.paragraph.create(
    null,
    parts.map(([text, code]) =>
      schema.text(text, code ? [schema.marks.code_inline.create()] : undefined)
    )
  );
}

/**
 * Collects the ranges of all word decorations for a state.
 *
 * @param state Editor state containing the plugin.
 * @param plugin The code word decorations plugin.
 * @returns Sorted decoration ranges.
 */
function wordRanges(
  state: EditorState,
  plugin: Plugin<{ decorations: DecorationSet }>
): Array<{ from: number; to: number }> {
  const pluginState = plugin.getState(state);
  if (!pluginState) {
    return [];
  }
  return pluginState.decorations
    .find(0, state.doc.content.size)
    .map((decoration) => ({ from: decoration.from, to: decoration.to }))
    .sort((a, b) => a.from - b.from);
}

describe("CodeWordDecorationsPlugin", () => {
  it("decorates each space-separated word of inline code", () => {
    const plugin = codeWordDecorations();
    const state = createEditorState(
      doc([
        mixedParagraph([
          ["a ", false],
          ["x y", true],
          [" b", false],
        ]),
      ]),
      [plugin]
    );

    // Code segment spans [3, 6): "x" at [3, 4) and "y" at [5, 6).
    expect(wordRanges(state, plugin)).toEqual([
      { from: 3, to: 4 },
      { from: 5, to: 6 },
    ]);
  });

  it("leaves tokens longer than the max word length unwrapped", () => {
    const plugin = codeWordDecorations({ maxWordLength: 4 });
    const long = "abcdef";
    const state = createEditorState(doc([mixedParagraph([[long, true]])]), [
      plugin,
    ]);

    expect(wordRanges(state, plugin)).toEqual([]);
  });

  it("maps decorations when only unmarked text changes", () => {
    const plugin = codeWordDecorations();
    let state = createEditorState(
      doc([
        mixedParagraph([
          ["a ", false],
          ["x y", true],
          [" b", false],
        ]),
        paragraph("tail"),
      ]),
      [plugin]
    );

    expect(wordRanges(state, plugin)).toEqual([
      { from: 3, to: 4 },
      { from: 5, to: 6 },
    ]);

    // Inserting plain text before shifts positions but adds no words.
    state = state.apply(state.tr.insertText("hello ", 1));
    expect(wordRanges(state, plugin)).toEqual([
      { from: 9, to: 10 },
      { from: 11, to: 12 },
    ]);
  });

  it("rebuilds when a mark is added to previously plain text", () => {
    const plugin = codeWordDecorations();
    let state = createEditorState(doc([mixedParagraph([["ab", false]])]), [
      plugin,
    ]);
    expect(wordRanges(state, plugin)).toEqual([]);

    state = state.apply(
      state.tr.addMark(1, 3, schema.marks.code_inline.create())
    );
    expect(wordRanges(state, plugin)).toEqual([{ from: 1, to: 3 }]);
  });

  it("rebuilds when the code_inline mark is removed", () => {
    const plugin = codeWordDecorations();
    let state = createEditorState(doc([mixedParagraph([["ab", true]])]), [
      plugin,
    ]);
    expect(wordRanges(state, plugin)).toEqual([{ from: 1, to: 3 }]);

    state = state.apply(state.tr.removeMark(1, 3, schema.marks.code_inline));
    expect(wordRanges(state, plugin)).toEqual([]);
  });

  it("drops decorations when a whole marked segment is deleted", () => {
    const plugin = codeWordDecorations();
    let state = createEditorState(
      doc([
        mixedParagraph([
          ["a ", false],
          ["xy", true],
          [" c", false],
        ]),
      ]),
      [plugin]
    );
    expect(wordRanges(state, plugin)).toEqual([{ from: 3, to: 5 }]);

    // Delete the marked segment "xy" (positions 3..5); adjacent plain text
    // remains so no surviving node changes identity.
    state = state.apply(state.tr.delete(3, 5));
    expect(wordRanges(state, plugin)).toEqual([]);
  });

  it("detects edits inside a marked segment via changed descendants", () => {
    const plugin = codeWordDecorations();
    let state = createEditorState(
      doc([
        mixedParagraph([
          ["a ", false],
          ["x", true],
          [" c", false],
        ]),
      ]),
      [plugin]
    );

    // Replace the marked "x" with longer marked text: "xz y".
    state = state.apply(
      state.tr.replaceWith(
        3,
        4,
        schema.text("xz y", [schema.marks.code_inline.create()])
      )
    );

    // Segment spans [3, 7): "xz" at [3, 5), "y" at [6, 7).
    expect(wordRanges(state, plugin)).toEqual([
      { from: 3, to: 5 },
      { from: 6, to: 7 },
    ]);
  });
});
