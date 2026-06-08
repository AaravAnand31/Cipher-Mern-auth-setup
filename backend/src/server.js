require("dotenv").config();

const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const http     = require("http");
const { Server } = require("socket.io");

console.log("Starting server...");

/* ════════════════════════════════════════════════
   MODELS  (all inline — no separate files needed)
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
    photoURL:    { type: String,   default: "" },   // stored as base64
    coverURL:    { type: String,   default: "" },   // stored as base64
    profileDone: { type: Boolean,  default: false },
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
    senderUser:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text:         { type: String, required: true },
}, { timestamps: true }));


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
app.use(express.json({ limit: "15mb" }));   // 15mb for base64 photos


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

// Update profile  ← THIS was the missing route causing Issue 4
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

// Discover — exclude self + already connected
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

        res.status(200).json(users);
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
        res.status(200).json(users);
    } catch (e) { res.status(500).json({ message: "Server error" }); }
});

// Get one user
app.get("/api/users/:id", auth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password").lean();
        if (!user) return res.status(404).json({ message: "Not found" });
        res.status(200).json(user);
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

// All my accepted connections (for chat list)
app.get("/api/connections", auth, async (req, res) => {
    try {
        const conns = await Connection.find({
            $or: [{ fromUser: req.user }, { toUser: req.user }],
            status: "accepted",
        }).populate("fromUser", "-password").populate("toUser", "-password").lean();

        const result = conns.map(c => {
            const isMe = c.fromUser._id.toString() === req.user.toString();
            return { connectionId: c._id, user: isMe ? c.toUser : c.fromUser, connectedAt: c.updatedAt };
        });
        res.status(200).json(result);
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


/* ════════════════════════════════════════════════
   SOCKET.IO — Live Chat
════════════════════════════════════════════════ */
io.on("connection", socket => {

    // User identifies themselves
    socket.on("user_online", userId => {
        socket.userId = userId;
        socket.join(`user_${userId}`);      // personal room for notifications
    });

    // Join a chat room (one room per connection)
    socket.on("join_chat", connectionId => {
        socket.join(connectionId);
    });

    // Send a message
    socket.on("send_message", async ({ connectionId, senderUserId, text }) => {
        try {
            if (!text?.trim()) return;

            // Save to DB
            const msg = await Message.create({ connectionId, senderUser: senderUserId, text: text.trim() });
            const populated = await Message.findById(msg._id)
                .populate("senderUser", "username photoURL").lean();

            // Broadcast to both users in the chat room
            io.to(connectionId).emit("new_message", populated);

        } catch (e) { console.log("msg error:", e); }
    });

    // Typing indicator
    socket.on("typing", ({ connectionId, isTyping }) => {
        socket.to(connectionId).emit("user_typing", { userId: socket.userId, isTyping });
    });

    socket.on("disconnect", () => {
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
            console.log(`Routes ready:`);
            console.log(`  POST /api/auth/register`);
            console.log(`  POST /api/auth/login`);
            console.log(`  PUT  /api/auth/profile`);
            console.log(`  GET  /api/users/discover`);
            console.log(`  POST /api/connections/request`);
            console.log(`  GET  /api/connections/requests`);
            console.log(`  GET  /api/messages/:connectionId`);
        });
    })
    .catch(err => console.log("Mongo Error:", err));