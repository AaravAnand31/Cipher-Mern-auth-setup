require("dotenv").config();

const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const http     = require("http");
const { Server } = require("socket.io");

console.log("Starting Cipher server...");

/* ═══════════════════════════════════════════════
   SCHEMAS
═══════════════════════════════════════════════ */

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
    lastSeen:    { type: Date,     default: null  },
}, { timestamps: true }));

const connSchema = new mongoose.Schema({
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    toUser:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status:   { type: String, enum: ["pending","accepted","rejected"], default: "pending" },
}, { timestamps: true });
connSchema.index({ fromUser: 1, toUser: 1 }, { unique: true });
const Connection = mongoose.model("Connection", connSchema);

const Message = mongoose.model("Message", new mongoose.Schema({
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: "Connection", required: true },
    senderUser:   { type: mongoose.Schema.Types.ObjectId, ref: "User",       required: true },
    text:         { type: String,  required: true },
    seen:         { type: Boolean, default: false },
    seenAt:       { type: Date,    default: null  },
    isDeleted:    { type: Boolean, default: false },
}, { timestamps: true }));


/* ═══════════════════════════════════════════════
   AUTH MIDDLEWARE
═══════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════
   ONLINE USERS MAP  userId(string) → socketId
═══════════════════════════════════════════════ */
const onlineUsers = new Map();

/* ═══════════════════════════════════════════════
   EXPRESS + SOCKET.IO
═══════════════════════════════════════════════ */
const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "15mb" }));


/* ═══════════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════════ */
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

app.get("/api/auth/me", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user).select("-password");
        res.status(200).json(user);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

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


/* ═══════════════════════════════════════════════
   USER ROUTES
═══════════════════════════════════════════════ */
app.get("/api/users/discover", auth, async (req, res) => {
    try {
        const me    = req.user;
        const limit = parseInt(req.query.limit) || 10;
        const skip  = parseInt(req.query.skip)  || 0;
        const myConns = await Connection.find({ $or:[{fromUser:me},{toUser:me}] }).lean();
        const hide = [me, ...myConns.map(c =>
            c.fromUser.toString() === me.toString() ? c.toUser : c.fromUser
        )];
        const users = await User.find({ _id: { $nin: hide } })
            .select("-password").limit(limit).skip(skip).lean();
        res.status(200).json(users.map(u => ({ ...u, isOnline: onlineUsers.has(u._id.toString()) })));
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});

app.get("/api/users/online", auth, (req, res) => {
    res.json({ onlineIds: [...onlineUsers.keys()] });
});

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
        res.status(200).json(users.map(u => ({ ...u, isOnline: onlineUsers.has(u._id.toString()) })));
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

app.get("/api/users/:id", auth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password").lean();
        if (!user) return res.status(404).json({ message: "Not found" });
        res.status(200).json({ ...user, isOnline: onlineUsers.has(user._id.toString()) });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});


/* ═══════════════════════════════════════════════
   CONNECTION ROUTES
═══════════════════════════════════════════════ */
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
        // Notify receiver
        const receiverSocket = onlineUsers.get(toUserId.toString());
        if (receiverSocket) io.to(receiverSocket).emit("new_request", { fromUserId: from });
        res.status(201).json({ message: "Request sent", connection: conn });
    } catch (e) { console.log(e); res.status(500).json({ message: "Server error" }); }
});

app.post("/api/connections/accept", auth, async (req, res) => {
    try {
        const conn = await Connection.findById(req.body.connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });
        if (conn.toUser.toString() !== req.user.toString())
            return res.status(403).json({ message: "Not authorized" });
        conn.status = "accepted"; await conn.save();
        const senderSocket = onlineUsers.get(conn.fromUser.toString());
        if (senderSocket) io.to(senderSocket).emit("request_accepted", { by: req.user });
        res.status(200).json({ message: "Accepted", connection: conn });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

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

app.get("/api/connections/requests", auth, async (req, res) => {
    try {
        const reqs = await Connection.find({ toUser: req.user, status: "pending" })
            .populate("fromUser", "-password").sort({ createdAt: -1 }).lean();
        res.status(200).json(reqs.map(r => ({
            ...r, fromUser: { ...r.fromUser, isOnline: onlineUsers.has(r.fromUser._id.toString()) }
        })));
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

app.get("/api/connections", auth, async (req, res) => {
    try {
        const userId = req.user;
        const conns  = await Connection.find({
            $or: [{ fromUser: userId }, { toUser: userId }], status: "accepted",
        }).populate("fromUser", "-password").populate("toUser", "-password").lean();

        const result = await Promise.all(conns.map(async c => {
            const isMe  = c.fromUser._id.toString() === userId.toString();
            const other = isMe ? c.toUser : c.fromUser;
            const unreadCount = await Message.countDocuments({
                connectionId: c._id, senderUser: other._id, seen: false, isDeleted: false,
            });
            return {
                connectionId: c._id,
                user: { ...other, isOnline: onlineUsers.has(other._id.toString()) },
                connectedAt: c.updatedAt,
                unreadCount,
            };
        }));
        result.sort((a, b) => b.unreadCount - a.unreadCount);
        res.status(200).json(result);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

app.get("/api/connections/unread-total", auth, async (req, res) => {
    try {
        const userId  = req.user;
        const myConns = await Connection.find({
            $or: [{ fromUser: userId }, { toUser: userId }], status: "accepted",
        }).lean();
        let total = 0;
        for (const c of myConns) {
            const otherId = c.fromUser.toString() === userId.toString() ? c.toUser : c.fromUser;
            total += await Message.countDocuments({
                connectionId: c._id, senderUser: otherId, seen: false, isDeleted: false,
            });
        }
        res.status(200).json({ total });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

app.get("/api/connections/count", auth, async (req, res) => {
    try {
        const count = await Connection.countDocuments({
            $or: [{ fromUser: req.user }, { toUser: req.user }], status: "accepted",
        });
        res.status(200).json({ count });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});


/* ═══════════════════════════════════════════════
   MESSAGE ROUTES
═══════════════════════════════════════════════ */
app.get("/api/messages/:connectionId", auth, async (req, res) => {
    try {
        const userId = req.user;
        const conn   = await Connection.findById(req.params.connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });
        const involved = conn.fromUser.toString() === userId.toString() ||
                         conn.toUser.toString()   === userId.toString();
        if (!involved) return res.status(403).json({ message: "Not authorized" });
        const msgs = await Message.find({ connectionId: req.params.connectionId })
            .populate("senderUser", "username photoURL")
            .sort({ createdAt: 1 }).lean();
        res.status(200).json(msgs);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

app.post("/api/messages/:connectionId/seen", auth, async (req, res) => {
    try {
        const userId = req.user;
        await Message.updateMany(
            { connectionId: req.params.connectionId, senderUser: { $ne: userId }, seen: false },
            { $set: { seen: true, seenAt: new Date() } }
        );
        io.to(req.params.connectionId).emit("messages_seen", {
            connectionId: req.params.connectionId,
            seenBy: userId.toString(),
        });
        res.status(200).json({ message: "Marked as seen" });
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

app.delete("/api/messages/:messageId", auth, async (req, res) => {
    try {
        const userId    = req.user.toString();
        const messageId = req.params.messageId;

        if (!mongoose.Types.ObjectId.isValid(messageId))
            return res.status(400).json({ message: "Invalid message ID" });

        const msg = await Message.findById(messageId);
        if (!msg) return res.status(404).json({ message: "Message not found" });
        if (msg.senderUser.toString() !== userId)
            return res.status(403).json({ message: "You can only delete your own messages" });

        msg.isDeleted = true;
        await msg.save();

        const roomId = msg.connectionId?.toString();
        if (roomId) io.to(roomId).emit("message_deleted", { messageId: msg._id.toString() });

        res.status(200).json({ message: "Deleted" });
    } catch (e) {
        console.log("Delete error:", e);
        res.status(500).json({ message: "Server error: " + e.message });
    }
});


/* ═══════════════════════════════════════════════
   SOCKET.IO
   FIX: send_message only emits to the chat ROOM.
   A separate "message_notification" event goes to
   the receiver's personal room for badge updates.
   This prevents the duplicate message bug.
═══════════════════════════════════════════════ */
io.on("connection", socket => {

    socket.on("user_online", async (userId) => {
        if (!userId) return;
        socket.userId = userId;
        onlineUsers.set(userId, socket.id);
        socket.join(`user_${userId}`);

        // Tell online friends this user came online
        try {
            const conns = await Connection.find({
                $or: [{ fromUser: userId }, { toUser: userId }], status: "accepted",
            }).lean();
            conns.forEach(c => {
                const otherId = c.fromUser.toString() === userId ? c.toUser.toString() : c.fromUser.toString();
                const otherSocket = onlineUsers.get(otherId);
                if (otherSocket) io.to(otherSocket).emit("friend_online", { userId });
            });
        } catch (_) {}
    });

    socket.on("join_chat", connectionId => {
        socket.join(connectionId);
    });

    socket.on("leave_chat", connectionId => {
        socket.leave(connectionId);
    });

    // FIX: Only emit new_message to the chat ROOM.
    // Emit message_notification to receiver's personal room for badge only.
    socket.on("send_message", async ({ connectionId, senderUserId, text }) => {
        try {
            if (!text?.trim()) return;

            const msg = await Message.create({
                connectionId,
                senderUser: senderUserId,
                text: text.trim(),
            });

            const populated = await Message.findById(msg._id)
                .populate("senderUser", "username photoURL")
                .lean();

            // Send new_message ONLY to the chat room — both users who joined it get it once
            io.to(connectionId).emit("new_message", populated);

            // Send a SEPARATE lightweight notification to receiver's personal room
            // This is just for the badge — it does NOT render a message
            try {
                const conn = await Connection.findById(connectionId).lean();
                if (conn) {
                    const receiverId = conn.fromUser.toString() === senderUserId.toString()
                        ? conn.toUser.toString()
                        : conn.fromUser.toString();

                    // Only send if receiver is NOT in the chat room
                    const receiverSocket = onlineUsers.get(receiverId);
                    if (receiverSocket) {
                        io.to(`user_${receiverId}`).emit("message_notification", {
                            connectionId,
                            senderUserId,
                            preview: text.trim().slice(0, 50),
                        });
                    }
                }
            } catch (_) {}

        } catch (e) { console.log("send_message error:", e); }
    });

    socket.on("typing", ({ connectionId, isTyping }) => {
        socket.to(connectionId).emit("user_typing", { userId: socket.userId, isTyping });
    });

    socket.on("disconnect", async () => {
        if (!socket.userId) return;
        onlineUsers.delete(socket.userId);
        try {
            await User.findByIdAndUpdate(socket.userId, { lastSeen: new Date() });
            const conns = await Connection.find({
                $or: [{ fromUser: socket.userId }, { toUser: socket.userId }], status: "accepted",
            }).lean();
            conns.forEach(c => {
                const otherId = c.fromUser.toString() === socket.userId
                    ? c.toUser.toString() : c.fromUser.toString();
                const otherSocket = onlineUsers.get(otherId);
                if (otherSocket) io.to(otherSocket).emit("friend_offline", {
                    userId: socket.userId, lastSeen: new Date(),
                });
            });
        } catch (_) {}
    });
});


/* ═══════════════════════════════════════════════
   START
═══════════════════════════════════════════════ */
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected ✓");
        app.get("/", (req, res) => res.send("Cipher Backend ✓"));
        const PORT = process.env.PORT || 5500;
        httpServer.listen(PORT, () => console.log(`Server running on port ${PORT} ✓`));
    })
    .catch(err => { console.log("MongoDB Error:", err); process.exit(1); });