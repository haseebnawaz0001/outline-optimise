import { isNull } from "es-toolkit/compat";
import type { NodeSpec } from "prosemirror-model";
import { PlaceholderPlugin } from "../plugins/PlaceholderPlugin";
import Node from "./Node";

/**
 * Options for the Doc node.
 */
type DocOptions = {
  /** Placeholder text shown when the document is empty. */
  placeholder: string;
};

export default class Doc extends Node<DocOptions> {
  get name() {
    return "doc";
  }

  get schema(): NodeSpec {
    return {
      content: "block+",
    };
  }

  get plugins() {
    return [
      new PlaceholderPlugin(
        [
          {
            // The document-level emptiness check (doc text content === "") is
            // implied by the structural checks below: when the document's only
            // child has no inline content there is no text anywhere in it, so
            // the plugin can use an O(1) fast path instead of walking the
            // whole document on every keystroke.
            condition: ({ $start, parent, node, state }) =>
              !isNull(parent) &&
              parent.type === state.doc.type &&
              parent.childCount === 1 &&
              node.childCount === 0 &&
              $start.index($start.depth - 1) === 0,
            text: this.options.placeholder,
          },
        ],
        ["paragraph"],
        {
          // The condition above can only match a document consisting of a
          // single empty paragraph; anything else short-circuits to empty.
          canMatch: (doc) =>
            doc.childCount === 1 &&
            doc.firstChild?.type.name === "paragraph" &&
            doc.firstChild.content.size === 0,
        }
      ),
    ];
  }
}
