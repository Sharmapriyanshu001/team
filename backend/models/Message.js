import mongoose from "mongoose";

/**
 * A conversation is identified by (scope + roomId). Each scope names one pair
 * of participants so nobody's thread bleeds into anybody else's:
 *
 *   client          admin    <-> client      room = client id
 *   client_leader   leader   <-> client      room = client id
 *   client_employee employee <-> client      room = client id
 *   team_leader     admin    <-> leader      room = leader id
 *   employee        leader   <-> employee    room = employee id
 *   employee_admin  admin    <-> employee    room = employee id
 *   project         everyone on a project    room = project id
 */
export const CHAT_SCOPES = [
  "client",
  "client_leader",
  "client_employee",
  "team_leader",
  "employee",
  "employee_admin",
  "project",
];
const messageSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: CHAT_SCOPES, required: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    senderName: { type: String, trim: true, default: "Admin" },
    text: { type: String, required: true, trim: true },
    readByAdmin: { type: Boolean, default: true },
  },
  { timestamps: true }
);

messageSchema.index({ scope: 1, roomId: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
