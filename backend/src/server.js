require("dotenv").config();

const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const http     = require("http");
const { Server } = require("socket.io");

console.log("Starting Cipher server...");

/* ════════════════════════════════════════════════
   MODELS
════════════════════════════════════════════════ */

const User = mongoose.model("User", new mongoose.Schema({
    username:    { type: String, required: true },
    email:       { type: String, required: true, unique: true },
    password:    { type: String, required: true },
    year:        { type: String,   default: "" },
    department:  { type: String,   default: "" },
    bio:         { type: String,   default: "" },
    icebreaker:  { type: String,   default: "" },
    interests:   { type: [String], default: [] },
    lookingFor:  { type: [String], default: [] },
    openTo:      { type: [String], default: ["Everyone"] },
    photoURL:    { type: String,   default: "" },
    coverURL:    { type: String,   default: "" },
    profileDone: { type: Boolean,  default: false },
    // ── NEW: lastSeen for "Last seen X ago" feature ──
    lastSeen:    { type: Date,     default: null },
}, { timestamps: true }));

const connSchema = new mongoose.Schema({
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    toUser:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status:   { type: String, enum: ["pending","accepted","rejected"], default: "pending" },
}, { timestamps: true });
connSchema.index({ fromUser: 1, toUser: 1 }, { unique: true });
const Connection = mongoose.model("Connection", connSchema);

const msgSchema = new mongoose.Schema({
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: "Connection", required: true },
    senderUser:   { type: mongoose.Schema.Types.ObjectId, ref: "User",       required: true },
    text:         { type: String, required: true },
    // ── NEW: soft-delete ──
    isDeleted:    { type: Boolean, default: false },
    // ── NEW: read receipts ──
    seen:         { type: Boolean, default: false },
    seenAt:       { type: Date,    default: null },
}, { timestamps: true });
const Message = mongoose.model("Message", msgSchema);


/* ════════════════════════════════════════════════
   AUTH MIDDLEWARE
════════════════════════════════════════════════ */
function auth(req, res, next) {
    try {
        const h = req.header("Authorization");
        if (!h) return res.status(401).json({ message: "No token" });
        const token = h.startsWith("Bearer ") ? h.slice(7) : h;
        req.user = jwt.verify(token, process.env.JWT_SECRET).id;
        next();
    } catch (e) {
        res.status(401).json({ message: "Invalid token" });
    }
}


/* ════════════════════════════════════════════════
   EXPRESS + SOCKET.IO SETUP
════════════════════════════════════════════════ */
const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "15mb" }));


/* ════════════════════════════════════════════════
   ONLINE USERS MAP  (userId → socketId)
   Used for online/offline status & lastSeen
════════════════════════════════════════════════ */
const onlineUsers = new Map();  // Map<userId:string, socketId:string>


/* ════════════════════════════════════════════════
   AUTH ROUTES  /api/auth/...
════════════════════════════════════════════════ */

// Register
app.post("/api/auth/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (await User.findOne({ email }))
            return res.status(400).json({ message: "User already exists" });
        const hashed = await bcrypt.hash(password, 10);
        await User.create({ username, email, password: hashed });
        res.status(201).json({ message: "Registered successfully" });
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});

// Login
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password)))
            return res.status(400).json({ message: "Invalid credentials" });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        const u = user.toObject(); delete u.password;
        res.status(200).json({ token, user: u });
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});

// Get current user
app.get("/api/auth/me", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user).select("-password");
        res.status(200).json(user);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// Update profile
app.put("/api/auth/profile", auth, async (req, res) => {
    try {
        const fields = ["username","year","department","bio","icebreaker",
                        "interests","lookingFor","openTo","photoURL","coverURL"];
        const updates = { profileDone: true };
        fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
        const user = await User.findByIdAndUpdate(
            req.user, { $set: updates }, { new: true, select: "-password" }
        );
        res.status(200).json({ message: "Profile updated", user });
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});


/* ════════════════════════════════════════════════
   USER ROUTES  /api/users/...
════════════════════════════════════════════════ */

// Discover
app.get("/api/users/discover", auth, async (req, res) => {
    try {
        const me    = req.user;
        const limit = parseInt(req.query.limit) || 10;
        const skip  = parseInt(req.query.skip)  || 0;

        const myConns = await Connection.find({ $or: [{ fromUser: me }, { toUser: me }] }).lean();
        const hide = [me, ...myConns.map(c =>
            c.fromUser.toString() === me.toString() ? c.toUser : c.fromUser
        )];

        const users = await User.find({ _id: { $nin: hide } })
            .select("-password")
            .limit(limit).skip(skip).lean();

        // Attach online status
        const result = users.map(u => ({
            ...u,
            isOnline: onlineUsers.has(u._id.toString()),
        }));

        res.status(200).json(result);
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});

// Search users
app.get("/api/users", auth, async (req, res) => {
    try {
        const me = req.user;
        const s  = req.query.search || "";
        const filter = { _id: { $ne: me } };
        if (s) filter.$or = [
            { username:   { $regex: s, $options: "i" } },
            { department: { $regex: s, $options: "i" } },
            { interests:  { $elemMatch: { $regex: s, $options: "i" } } },
        ];
        const users = await User.find(filter).select("-password").limit(20).lean();
        const result = users.map(u => ({
            ...u,
            isOnline: onlineUsers.has(u._id.toString()),
        }));
        res.status(200).json(result);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// Get one user
app.get("/api/users/:id", auth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password").lean();
        if (!user) return res.status(404).json({ message: "Not found" });
        res.status(200).json({
            ...user,
            isOnline: onlineUsers.has(user._id.toString()),
        });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});


/* ════════════════════════════════════════════════
   CONNECTION ROUTES  /api/connections/...
════════════════════════════════════════════════ */

// Send request
app.post("/api/connections/request", auth, async (req, res) => {
    try {
        const from = req.user;
        const { toUserId } = req.body;
        if (!toUserId) return res.status(400).json({ message: "Missing toUserId" });
        const existing = await Connection.findOne({
            $or: [{ fromUser: from, toUser: toUserId }, { fromUser: toUserId, toUser: from }]
        });
        if (existing) return res.status(400).json({ message: `Already ${existing.status}` });
        const conn = await Connection.create({ fromUser: from, toUser: toUserId });
        res.status(201).json({ message: "Request sent", connection: conn });
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});

// Accept
app.post("/api/connections/accept", auth, async (req, res) => {
    try {
        const conn = await Connection.findById(req.body.connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });
        if (conn.toUser.toString() !== req.user.toString())
            return res.status(403).json({ message: "Not authorized" });
        conn.status = "accepted"; await conn.save();
        res.status(200).json({ message: "Accepted", connection: conn });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// Reject
app.post("/api/connections/reject", auth, async (req, res) => {
    try {
        const conn = await Connection.findById(req.body.connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });
        if (conn.toUser.toString() !== req.user.toString())
            return res.status(403).json({ message: "Not authorized" });
        conn.status = "rejected"; await conn.save();
        res.status(200).json({ message: "Rejected" });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// Pending requests sent TO me
app.get("/api/connections/requests", auth, async (req, res) => {
    try {
        const reqs = await Connection.find({ toUser: req.user, status: "pending" })
            .populate("fromUser", "-password")
            .sort({ createdAt: -1 }).lean();
        res.status(200).json(reqs);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// ── FIX #1 + FEATURE #2: All accepted connections WITH count + online status ──
app.get("/api/connections", auth, async (req, res) => {
    try {
        const conns = await Connection.find({
            $or: [{ fromUser: req.user }, { toUser: req.user }],
            status: "accepted",
        }).populate("fromUser", "-password").populate("toUser", "-password").lean();

        const result = conns.map(c => {
            const isMe = c.fromUser._id.toString() === req.user.toString();
            const other = isMe ? c.toUser : c.fromUser;
            return {
                connectionId: c._id,
                user: {
                    ...other,
                    isOnline: onlineUsers.has(other._id.toString()),
                },
                connectedAt: c.updatedAt,
            };
        });
        res.status(200).json(result);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// ── FEATURE #1 FIX: Connection count for profile ──
app.get("/api/connections/count", auth, async (req, res) => {
    try {
        const count = await Connection.countDocuments({
            $or: [{ fromUser: req.user }, { toUser: req.user }],
            status: "accepted",
        });
        res.status(200).json({ count });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});


/* ════════════════════════════════════════════════
   MESSAGE ROUTES  /api/messages/...
════════════════════════════════════════════════ */

// Load chat history
app.get("/api/messages/:connectionId", auth, async (req, res) => {
    try {
        const conn = await Connection.findById(req.params.connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });
        const isInvolved =
            conn.fromUser.toString() === req.user.toString() ||
            conn.toUser.toString()   === req.user.toString();
        if (!isInvolved) return res.status(403).json({ message: "Not authorized" });

        const msgs = await Message.find({ connectionId: req.params.connectionId })
            .populate("senderUser", "username photoURL")
            .sort({ createdAt: 1 }).lean();

        res.status(200).json(msgs);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// ── FEATURE #6: Mark messages as seen ──
app.post("/api/messages/:connectionId/seen", auth, async (req, res) => {
    try {
        const conn = await Connection.findById(req.params.connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });
        const isInvolved =
            conn.fromUser.toString() === req.user.toString() ||
            conn.toUser.toString()   === req.user.toString();
        if (!isInvolved) return res.status(403).json({ message: "Not authorized" });

        // Mark all messages NOT sent by me as seen
        const result = await Message.updateMany(
            {
                connectionId: req.params.connectionId,
                senderUser: { $ne: req.user },
                seen: false,
                isDeleted: false,
            },
            { $set: { seen: true, seenAt: new Date() } }
        );

        // Emit seen event via socket so sender's UI updates
        io.to(req.params.connectionId).emit("messages_seen", {
            connectionId: req.params.connectionId,
            seenBy: req.user,
            seenAt: new Date(),
        });

        res.status(200).json({ updated: result.modifiedCount });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// ── FEATURE #5: Unread count per connection ──
app.get("/api/messages/:connectionId/unread", auth, async (req, res) => {
    try {
        const count = await Message.countDocuments({
            connectionId: req.params.connectionId,
            senderUser: { $ne: req.user },
            seen: false,
            isDeleted: false,
        });
        res.status(200).json({ count });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// ── FEATURE #7: Soft-delete a message ──
app.delete("/api/messages/:messageId", auth, async (req, res) => {
    try {
        const msg = await Message.findById(req.params.messageId);
        if (!msg) return res.status(404).json({ message: "Message not found" });
        if (msg.senderUser.toString() !== req.user.toString())
            return res.status(403).json({ message: "You can only delete your own messages" });

        msg.isDeleted = true;
        await msg.save();

        // Notify everyone in the chat room
        io.to(msg.connectionId.toString()).emit("message_deleted", {
            messageId: msg._id,
            connectionId: msg.connectionId,
        });

        res.status(200).json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});


/* ════════════════════════════════════════════════
   SOCKET.IO — Live Chat + Presence
════════════════════════════════════════════════ */
io.on("connection", socket => {

    // ── User comes online ──
    socket.on("user_online", userId => {
        socket.userId = userId;
        socket.join(`user_${userId}`);
        onlineUsers.set(userId, socket.id);
        // Broadcast to everyone that this user is online
        socket.broadcast.emit("user_status_change", { userId, isOnline: true });
    });

    // ── Join a chat room ──
    socket.on("join_chat", connectionId => {
        socket.join(connectionId);
    });

    // ── Send a message ──
    socket.on("send_message", async ({ connectionId, senderUserId, text }) => {
        try {
            if (!text?.trim()) return;

            const msg = await Message.create({
                connectionId,
                senderUser: senderUserId,
                text: text.trim(),
            });
            const populated = await Message.findById(msg._id)
                .populate("senderUser", "username photoURL").lean();

            io.to(connectionId).emit("new_message", populated);

        } catch (e) { console.log("msg error:", e); }
    });

    // ── Typing indicator ──
    socket.on("typing", ({ connectionId, isTyping }) => {
        socket.to(connectionId).emit("user_typing", { userId: socket.userId, isTyping });
    });

    // ── User disconnects ──
    socket.on("disconnect", async () => {
        const userId = socket.userId;
        if (userId) {
            onlineUsers.delete(userId);

            // ── FEATURE #4: Update lastSeen ──
            try {
                await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
            } catch (e) { console.log("lastSeen update error:", e); }

            // Broadcast offline status
            socket.broadcast.emit("user_status_change", {
                userId,
                isOnline: false,
                lastSeen: new Date(),
            });
        }
        console.log("Socket disconnected:", socket.id);
    });
});


/* ════════════════════════════════════════════════
   START
════════════════════════════════════════════════ */
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected");

        app.get("/", (req, res) => res.send("Cipher Backend ✓"));

        const PORT = process.env.PORT || 5500;
        httpServer.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log("Routes:");
            console.log("  POST   /api/auth/register");
            console.log("  POST   /api/auth/login");
            console.log("  GET    /api/auth/me");
            console.log("  PUT    /api/auth/profile");
            console.log("  GET    /api/users/discover");
            console.log("  GET    /api/users");
            console.log("  GET    /api/users/:id");
            console.log("  POST   /api/connections/request");
            console.log("  POST   /api/connections/accept");
            console.log("  POST   /api/connections/reject");
            console.log("  GET    /api/connections/requests");
            console.log("  GET    /api/connections");
            console.log("  GET    /api/connections/count");
            console.log("  GET    /api/messages/:connectionId");
            console.log("  POST   /api/messages/:connectionId/seen");
            console.log("  GET    /api/messages/:connectionId/unread");
            console.log("  DELETE /api/messages/:messageId");
        });
    })
    .catch(err => console.log("Mongo Error:", err));