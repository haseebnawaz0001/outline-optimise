// @vitest-environment jsdom
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  type ExtensionState,
  SuggestionsMenuPlugin,
} from "./SuggestionsMenuPlugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

function p(text: string) {
  return schema.nodes.paragraph.create(
    null,
    text ? schema.text(text) : undefined
  );
}

function doc(...children: ReturnType<typeof p>[]) {
  return schema.nodes.doc.create(null, children);
}

const openRegex = /\/([\p{L}\d_-]*)$/u;
const triggerLength = 1;

interface Harness {
  view: EditorView;
  plugins: SuggestionsMenuPlugin[];
  states: ExtensionState[];
}

describe("SuggestionsMenuPlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("check coalescing", () => {
    let harness: Harness;

    beforeEach(() => {
      const plugins: SuggestionsMenuPlugin[] = [];
      const states: ExtensionState[] = [];

      for (let i = 0; i < 3; i++) {
        const extensionState: ExtensionState = {
          open: false,
          query: "",
          trigger: null,
          triggerPos: null,
        };
        states.push(extensionState);
        plugins.push(
          new SuggestionsMenuPlugin(
            extensionState,
            openRegex,
            true,
            triggerLength
          )
        );
      }

      const state = EditorState.create({
        doc: doc(p("")),
        schema,
        plugins,
      });
      const view = new EditorView(null, { state });

      harness = { view, plugins, states };

      vi.clearAllTimers();
    });

    afterEach(() => {
      harness.view.destroy();
    });

    function pressKey(key: string) {
      if (key.length === 1) {
        harness.view.dispatch(harness.view.state.tr.insertText(key));
      }
      const event = new KeyboardEvent("keydown", { key });
      for (const plugin of harness.plugins) {
        plugin.props.handleKeyDown?.call(plugin, harness.view, event);
      }
    }

    function spyOnExecute() {
      return harness.plugins.map((plugin) => vi.spyOn(plugin, "execute"));
    }

    it("runs all registered instance checks from a single macrotask", () => {
      const spies = spyOnExecute();

      pressKey("/");

      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersToNextTimer();

      expect(spies[0]).toHaveBeenCalledTimes(1);
      expect(spies[1]).toHaveBeenCalledTimes(1);
      expect(spies[2]).toHaveBeenCalledTimes(1);
      expect(spies[0].mock.invocationCallOrder[0]).toBeLessThan(
        spies[1].mock.invocationCallOrder[0]
      );
      expect(spies[1].mock.invocationCallOrder[0]).toBeLessThan(
        spies[2].mock.invocationCallOrder[0]
      );

      for (const extensionState of harness.states) {
        expect(extensionState.open).toBe(true);
        expect(extensionState.query).toBe("");
      }
    });

    it("replaces rather than stacks checks when a second keydown precedes the flush", () => {
      const spies = spyOnExecute();

      pressKey("/");
      pressKey("x");

      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersToNextTimer();

      expect(spies[0]).toHaveBeenCalledTimes(1);
      expect(spies[1]).toHaveBeenCalledTimes(1);
      expect(spies[2]).toHaveBeenCalledTimes(1);

      for (const extensionState of harness.states) {
        expect(extensionState.open).toBe(true);
        expect(extensionState.query).toBe("x");
      }
    });

    it("coalesces the backspace path into the same scheduler", () => {
      const spies = spyOnExecute();

      pressKey("/");
      vi.advanceTimersToNextTimer();
      expect(harness.states[0].open).toBe(true);

      vi.clearAllTimers();
      const position = harness.view.state.selection.from;
      harness.view.dispatch(
        harness.view.state.tr.insertText("", position - 1, position)
      );
      pressKey("Backspace");

      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersToNextTimer();

      expect(spies[0]).toHaveBeenCalledTimes(2);
      expect(spies[1]).toHaveBeenCalledTimes(2);
      expect(spies[2]).toHaveBeenCalledTimes(2);

      for (const extensionState of harness.states) {
        expect(extensionState.open).toBe(false);
      }
    });

    it("defers registrations made during a flush to the next macrotask", () => {
      const spies = spyOnExecute();

      let reRegistered = false;
      spies[1].mockImplementation(() => {
        if (!reRegistered) {
          reRegistered = true;
          const event = new KeyboardEvent("keydown", { key: "a" });
          harness.plugins[1].props.handleKeyDown?.call(
            harness.plugins[1],
            harness.view,
            event
          );
        }
        return false;
      });

      pressKey("/");

      vi.advanceTimersToNextTimer();

      expect(spies[0]).toHaveBeenCalledTimes(1);
      expect(spies[1]).toHaveBeenCalledTimes(1);
      expect(spies[2]).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersToNextTimer();

      expect(spies[1]).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("still opens the menu from the compositionupdate path", () => {
      harness.view.dispatch(harness.view.state.tr.insertText("/h"));

      for (const plugin of harness.plugins) {
        plugin.props.handleDOMEvents?.compositionupdate?.call(
          plugin,
          harness.view,
          new Event("compositionupdate")
        );
      }

      vi.runAllTimers();

      for (const extensionState of harness.states) {
        expect(extensionState.open).toBe(true);
        expect(extensionState.query).toBe("h");
      }
    });

    it("does not schedule a flush for keys that require no re-evaluation", () => {
      spyOnExecute();

      pressKey("ArrowDown");

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
