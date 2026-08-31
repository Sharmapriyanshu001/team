import { Component } from "react";

/**
 * A blank screen is the worst way to fail.
 *
 * The workspace pulls in Monaco, which is a large third-party module loaded on
 * its own chunk. If anything in it throws while mounting, React unmounts the
 * whole tree and the user is left staring at nothing with the real cause only
 * in the console. This catches that and says what happened, with a way back.
 */
export default class WorkspaceBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Workspace crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#0B0F1A] px-6 text-center">
        <p className="text-sm font-medium text-slate-200">The workspace could not start.</p>

        <pre className="max-w-xl overflow-auto rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-left font-mono text-[12px] leading-relaxed text-red-300">
          {this.state.error?.message || String(this.state.error)}
        </pre>

        <div className="flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Reload
          </button>
          <button
            onClick={() => {
              window.location.href = this.props.backTo || "/";
            }}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            Back to my projects
          </button>
        </div>

        <p className="max-w-md text-xs text-slate-500">
          Your files are untouched — nothing is saved unless you press Save.
        </p>
      </div>
    );
  }
}
