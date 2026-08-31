import mongoose from "mongoose";

/**
 * One term this client is trying to rank for, and where it has been.
 *
 * The rank history is embedded rather than kept as its own collection. A
 * keyword checked weekly for three years is about 150 points of two fields
 * each — small enough that the whole series arrives with the keyword, which is
 * exactly how every screen wants it: a graph needs the line, not one row.
 *
 * A separate collection would win only if somebody wanted to query across
 * every client's rank on a given day, and nobody does — the question is always
 * "how is this client's list moving".
 */

const rankPointSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    /**
     * Where it sat. Null means "not in the top 100", which is different from
     * zero and very different from missing: it is a real observation, and a
     * graph that drops the point would draw a line straight through a month
     * the term was nowhere.
     */
    position: { type: Number, default: null, min: 1, max: 100 },
  },
  { _id: false }
);

const seoKeywordSchema = new mongoose.Schema(
  {
    seoProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SeoProject",
      required: true,
    },

    term: { type: String, required: [true, "The keyword is required"], trim: true },

    // Where it is being measured. Most work is one engine in one country, but
    // "plumber in Jaipur" and "plumber" are different jobs.
    engine: { type: String, trim: true, default: "google" },
    location: { type: String, trim: true, default: "India" },
    device: { type: String, enum: ["desktop", "mobile"], default: "desktop" },

    /** Rough monthly search volume, when somebody has looked it up. */
    volume: { type: Number, default: 0, min: 0 },
    difficulty: { type: Number, default: 0, min: 0, max: 100 },

    // The URL that is meant to rank, so a term ranking with the wrong page is
    // visible rather than being counted as a win.
    targetUrl: { type: String, trim: true, default: "" },

    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },

    /**
     * Caches of the series below, written whenever a point is added. A list of
     * two hundred keywords would otherwise walk every history to draw a table.
     */
    currentPosition: { type: Number, default: null },
    previousPosition: { type: Number, default: null },
    bestPosition: { type: Number, default: null },
    lastCheckedAt: { type: Date },

    history: { type: [rankPointSchema], default: [] },
  },
  { timestamps: true }
);

// One row per term per project per place it is measured
seoKeywordSchema.index(
  { seoProject: 1, term: 1, engine: 1, location: 1, device: 1 },
  { unique: true }
);
seoKeywordSchema.index({ seoProject: 1, currentPosition: 1 });

const SeoKeyword = mongoose.model("SeoKeyword", seoKeywordSchema);

export default SeoKeyword;
