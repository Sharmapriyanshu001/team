import mongoose from "mongoose";

export const ATTENDANCE_STATUS = ["present", "absent", "half_day", "leave"];

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUS, default: "present" },
    checkIn: { type: String, default: "" },
    checkOut: { type: String, default: "" },
    note: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// One record per employee per day
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model("Attendance", attendanceSchema);

export default Attendance;
