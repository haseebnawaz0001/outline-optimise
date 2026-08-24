import {
  createEditorState,
  createEditorStateWithSelection,
  doc,
  heading,
  p,
  schema,
} from "@shared/test/editor";
import type { EditorState } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { PlaceholderPlugin } from "./PlaceholderPlugin";

/**
 * Collects the public position data of all decorations in a set.
 *
 * @param state Editor state holding the plugin.
 * @param plugin The placeholder plugin instance.
 * @returns Array of decoration ranges.
 */
function summarize(state: EditorState, plugin: PlaceholderPlugin) {
  return plugin
    .getState(state)!
    .decorations.find(0, state.doc.content.size)
    .map((decoration) => ({ from: decoration.from, to: decoration.to }));
}

describe("PlaceholderPlugin", () => {
  describe("Doc-style structural fast path", () => {
    function createDocPlaceholderPlugin() {
      // Mirrors the Doc node's instance: a placeholder shown only when the
      // whole document is a single empty eligible node.
      return new PlaceholderPlugin(
        [
          {
            condition: ({ $start, parent, node, state }) =>
              parent !== null &&
              parent.type === state.doc.type &&
              parent.childCount === 1 &&
              node.childCount === 0 &&
              $start.index($start.depth - 1) === 0,
            text: "Begin writing…",
          },
        ],
        ["paragraph"],
        {
          canMatch: (d) =>
            d.childCount === 1 &&
            d.firstChild?.type.name === "paragraph" &&
            d.firstChild.content.size === 0,
        }
      );
    }

    it("shows the placeholder when the document is a single empty paragraph", () => {
      const plugin = createDocPlaceholderPlugin();
      const state = createEditorState(doc([p("")]), [plugin]);

      expect(summarize(state, plugin)).toEqual([{ from: 0, to: 2 }]);
    });

    it("shows no placeholder when the document has more than one block", () => {
      const plugin = createDocPlaceholderPlugin();
      const state = createEditorState(doc([p(""), p("")]), [plugin]);

      expect(summarize(state, plugin)).toEqual([]);
    });

    it("shows no placeholder when the only paragraph has content", () => {
      const plugin = createDocPlaceholderPlugin();
      const state = createEditorState(doc([p("Hello")]), [plugin]);

      expect(summarize(state, plugin)).toEqual([]);
    });

    it("shows no placeholder for non-matching node types", () => {
      const plugin = createDocPlaceholderPlugin();
      const state = createEditorState(doc([heading("", 1)]), [plugin]);

      expect(summarize(state, plugin)).toEqual([]);
    });

    it("keeps placeholders correct across document changes", () => {
      const plugin = createDocPlaceholderPlugin();
      let state = createEditorState(doc([p("")]), [plugin]);
      expect(summarize(state, plugin)).toEqual([{ from: 0, to: 2 }]);

      // Typing removes the placeholder
      state = state.apply(state.tr.insertText("a", 1));
      expect(summarize(state, plugin)).toEqual([]);

      // Deleting the text restores it
      state = state.apply(state.tr.delete(1, 2));
      expect(summarize(state, plugin)).toEqual([{ from: 0, to: 2 }]);

      // A second paragraph removes it again
      state = state.apply(state.tr.insert(2, schema.nodes.paragraph.create()));
      expect(summarize(state, plugin)).toEqual([]);
    });
  });

  describe("gated recomputation", () => {
    const toggleBlock = (children: ReturnType<typeof p>[]) =>
      schema.nodes.container_toggle.create({ id: "toggle-1" }, children);

    /**
     * Builds the ToggleBlock-style gated plugin whose condition invocation
     * count is observable, so tests can distinguish full recomputation from
     * mapping.
     *
     * @returns Object with the plugin and a function reading the call count.
     */
    function createGatedPlugin() {
      let conditionCalls = 0;

      const plugin = new PlaceholderPlugin(
        [
          {
            condition: ({ node, $start, parent }) => {
              conditionCalls += 1;
              return (
                parent !== null &&
                parent.type.name === "container_toggle" &&
                $start.index($start.depth - 1) === 0 &&
                node.textContent === ""
              );
            },
            text: "Add title…",
          },
        ],
        ["paragraph", "heading"],
        {
          isChangedNodeRelevant: (node, $pos) => {
            if (node.type.name === "container_toggle") {
              return true;
            }
            for (let depth = 1; depth <= $pos.depth; depth++) {
              if ($pos.node(depth).type.name === "container_toggle") {
                return true;
              }
            }
            return false;
          },
        }
      );

      return { plugin, getCalls: () => conditionCalls };
    }

    it("recomputes when a toggle head is edited", () => {
      const { plugin, getCalls } = createGatedPlugin();
      const toggle = toggleBlock([p(""), p("")]);
      let state = createEditorStateWithSelection(doc([toggle]), 2, [plugin]);

      // Head spans [1, 3] inside the toggle.
      expect(summarize(state, plugin)).toEqual([{ from: 1, to: 3 }]);
      const before = getCalls();

      state = state.apply(state.tr.insertText("t", 2));
      expect(summarize(state, plugin)).toEqual([]);
      expect(getCalls()).toBeGreaterThan(before);

      state = state.apply(state.tr.delete(2, 3));
      expect(summarize(state, plugin)).toEqual([{ from: 1, to: 3 }]);
    });

    it("maps instead of recomputing when an unrelated paragraph is edited", () => {
      const { plugin, getCalls } = createGatedPlugin();
      const toggle = toggleBlock([p(""), p("body")]);
      let state = createEditorState(doc([p("first"), toggle]), [plugin]);

      expect(summarize(state, plugin)).toEqual([{ from: 8, to: 10 }]);
      const before = getCalls();

      // Edit the plain paragraph before the toggle; the change is irrelevant
      // so decorations are only mapped to their new positions.
      state = state.apply(state.tr.insertText("hey ", 1));
      expect(summarize(state, plugin)).toEqual([{ from: 12, to: 14 }]);
      expect(getCalls()).toBe(before);
    });

    it("keeps decorations valid when the selection moves within a plain paragraph", () => {
      const { plugin, getCalls } = createGatedPlugin();
      const toggle = toggleBlock([p(""), p("")]);
      const base = doc([p("outside"), toggle]);
      let state = createEditorState(base, [plugin]);
      const initialSummaries = summarize(state, plugin);
      const before = getCalls();

      // Cursor move inside "outside": no candidate boundary crossed.
      const $pos = state.doc.resolve(3);
      state = state.apply(state.tr.setSelection(TextSelection.near($pos)));

      expect(summarize(state, plugin)).toEqual(initialSummaries);
      expect(getCalls()).toBe(before);
    });

    it("recomputes when the selection moves into a toggle head", () => {
      const { plugin, getCalls } = createGatedPlugin();
      const toggle = toggleBlock([p(""), p("")]);
      let state = createEditorState(doc([p("outside"), toggle]), [plugin]);
      const before = getCalls();

      const headPos = state.doc.resolve(11);
      state = state.apply(state.tr.setSelection(TextSelection.near(headPos)));

      expect(getCalls()).toBeGreaterThan(before);
      expect(summarize(state, plugin)).toEqual([{ from: 10, to: 12 }]);
    });

    it("handles deletion of the whole toggle", () => {
      const { plugin } = createGatedPlugin();
      const toggle = toggleBlock([p(""), p("")]);
      let state = createEditorState(doc([p("keep"), toggle]), [plugin]);
      expect(summarize(state, plugin)).toEqual([{ from: 7, to: 9 }]);

      state = state.apply(state.tr.delete(5, state.doc.content.size));
      expect(summarize(state, plugin)).toEqual([]);
    });
  });
});
