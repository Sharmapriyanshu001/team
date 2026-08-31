import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

// monaco-editor 0.56 ships an exports map of "./*" -> "./esm/vs/*.js", so the
// esm/vs prefix must be left off or the subpath does not resolve.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

/**
 * Monaco, bundled with the app rather than fetched from a CDN.
 *
 * @monaco-editor/react loads the editor from jsdelivr by default. This is a
 * private office system that may well run without internet access, and a
 * workspace that cannot open a file because a CDN is unreachable is not much
 * of a workspace — so the local package is handed to the loader instead.
 *
 * This module is only imported by the workspace route, which is lazy-loaded,
 * so none of Monaco's weight lands on anyone who never opens a project.
 */

// Monaco does its language work in web workers; Vite gives each its own bundle.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

/**
 * The editor is a viewer for someone else's project, not a linter for it.
 * Squiggles from a TypeScript service that cannot see node_modules would be
 * noise on every import, so diagnostics are off while syntax colouring stays.
 *
 * Where these defaults live has moved between Monaco versions: 0.56 exports
 * them at the top level as `monaco.typescript`, older builds nested them under
 * `monaco.languages.typescript`. Both are tried, and every step is optional —
 * turning off a cosmetic warning must never be able to stop the editor from
 * loading, which is exactly what it did before this guard existed.
 */
const tsApi = monaco.typescript || monaco.languages?.typescript;

const quieten = (defaults) =>
  defaults?.setDiagnosticsOptions?.({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

try {
  quieten(tsApi?.typescriptDefaults);
  quieten(tsApi?.javascriptDefaults);
} catch (err) {
  console.warn("Monaco: could not turn off TypeScript diagnostics —", err.message);
}

export default monaco;
