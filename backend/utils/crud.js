import { logActivity } from "./activity.js";

/**
 * Thrown from a `beforeSave` hook to reject the request with a clean 400 and
 * the given message, instead of a generic server error.
 */
export class InvalidInput extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidInput";
  }
}

// Most admin sections are the same list/create/update/delete shape, so the
// handlers are generated from a small config instead of copy-pasted per model.
//
//   const clients = buildCrud(Client, { searchFields: ["name", "email"] });
//   router.get("/clients", clients.list);
//
export const buildCrud = (Model, options = {}) => {
  const {
    entity = Model.modelName,
    searchFields = [],
    filterFields = [],
    populate = [],
    sort = { createdAt: -1 },
    label = (doc) => doc?.name || doc?.title || String(doc?._id || ""),
    select = "",
    /**
     * What one record returns, when that is more than a row in the list does.
     *
     * A staff list of two hundred people has no use for everybody's Aadhaar
     * number and bank account, and sending them anyway puts the whole
     * company's identity documents into a browser to render a table. Opening
     * one person to edit them is a different question with a different answer,
     * so it gets its own select. Defaults to `select`, so nothing that does
     * not set it behaves any differently.
     */
    selectOne = null,
    // Extra conditions always applied (e.g. only role: "employee")
    scope = {},
    // Values forced onto every create (e.g. role: "employee")
    createDefaults = {},
    // Query conditions derived from the request (date ranges and the like)
    extraQuery,
    beforeSave,
    // Side effects once a record is saved — notifications, mostly.
    // Called as afterSave(doc, req, { isNew, previous })
    afterSave,
  } = options;

  const applyPopulate = (query) => {
    populate.forEach((p) => query.populate(p));
    return query;
  };

  const buildQuery = (req) => {
    const query = { ...scope };

    filterFields.forEach((field) => {
      const value = req.query[field];
      if (value !== undefined && value !== "" && value !== "all") {
        query[field] = value;
      }
    });

    if (extraQuery) Object.assign(query, extraQuery(req) || {});

    const search = (req.query.search || "").trim();
    if (search && searchFields.length) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = searchFields.map((field) => ({ [field]: regex }));
    }

    return query;
  };

  const list = async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const query = buildQuery(req);

      const [items, total] = await Promise.all([
        applyPopulate(
          Model.find(query)
            .select(select)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
        ),
        Model.countDocuments(query),
      ]);

      return res.status(200).json({
        items,
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
      });
    } catch (err) {
      console.error(`${entity} list error:`, err);
      return res.status(500).json({ message: "Server error" });
    }
  };

  const getOne = async (req, res) => {
    try {
      const item = await applyPopulate(
        Model.findById(req.params.id).select(selectOne ?? select)
      );
      if (!item) return res.status(404).json({ message: `${entity} not found` });
      return res.status(200).json({ item });
    } catch (err) {
      console.error(`${entity} getOne error:`, err);
      return res.status(500).json({ message: "Server error" });
    }
  };

  const create = async (req, res) => {
    try {
      let payload = { ...req.body, ...createDefaults };
      if (beforeSave) payload = await beforeSave(payload, req);

      const created = await Model.create(payload);
      const item = await applyPopulate(Model.findById(created._id).select(select));

      logActivity(req, {
        action: "created",
        entity,
        entityId: created._id,
        message: `${entity} "${label(created)}" created`,
      });

      if (afterSave) afterSave(created, req, { isNew: true });

      return res.status(201).json({ message: `${entity} created`, item });
    } catch (err) {
      console.error(`${entity} create error:`, err);
      if (err.name === "InvalidInput") {
        return res.status(400).json({ message: err.message });
      }
      if (err.code === 11000) {
        return res.status(409).json({ message: "A record with this value already exists" });
      }
      if (err.name === "ValidationError") {
        return res.status(400).json({ message: Object.values(err.errors)[0].message });
      }
      return res.status(500).json({ message: "Server error" });
    }
  };

  const update = async (req, res) => {
    try {
      const existing = await Model.findById(req.params.id);
      if (!existing) return res.status(404).json({ message: `${entity} not found` });

      // Snapshot before mutating, so afterSave can spot what actually changed.
      const previous = existing.toObject();

      let payload = { ...req.body };
      delete payload._id;
      if (beforeSave) payload = await beforeSave(payload, req, existing);

      Object.assign(existing, payload);
      await existing.save();

      const item = await applyPopulate(Model.findById(existing._id).select(select));

      logActivity(req, {
        action: "updated",
        entity,
        entityId: existing._id,
        message: `${entity} "${label(existing)}" updated`,
      });

      if (afterSave) afterSave(existing, req, { isNew: false, previous });

      return res.status(200).json({ message: `${entity} updated`, item });
    } catch (err) {
      console.error(`${entity} update error:`, err);
      if (err.name === "InvalidInput") {
        return res.status(400).json({ message: err.message });
      }
      if (err.code === 11000) {
        return res.status(409).json({ message: "A record with this value already exists" });
      }
      if (err.name === "ValidationError") {
        return res.status(400).json({ message: Object.values(err.errors)[0].message });
      }
      return res.status(500).json({ message: "Server error" });
    }
  };

  const remove = async (req, res) => {
    try {
      const existing = await Model.findById(req.params.id);
      if (!existing) return res.status(404).json({ message: `${entity} not found` });

      await existing.deleteOne();

      logActivity(req, {
        action: "deleted",
        entity,
        entityId: existing._id,
        message: `${entity} "${label(existing)}" deleted`,
      });

      return res.status(200).json({ message: `${entity} deleted` });
    } catch (err) {
      console.error(`${entity} remove error:`, err);
      return res.status(500).json({ message: "Server error" });
    }
  };

  return { list, getOne, create, update, remove };
};
