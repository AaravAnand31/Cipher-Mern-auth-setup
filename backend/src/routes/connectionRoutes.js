const express    = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const Connection = require("../models/connection");
const User       = require("../models/user");

const router = express.Router();


// ── POST /api/connections/request ─────────────────────
// Send a connection request to another user
router.post("/request", authMiddleware, async (req, res) => {
    try {
        const from = req.user;
        const { toUserId } = req.body;

        if (!toUserId || toUserId === from.toString()) {
            return res.status(400).json({ message: "Invalid user" });
        }

        // Check if connection already exists either direction
        const existing = await Connection.findOne({
            $or: [
                { fromUser: from, toUser: toUserId },
                { fromUser: toUserId, toUser: from },
            ],
        });

        if (existing) {
            return res.status(400).json({ message: `Already ${existing.status}` });
        }

        const conn = await Connection.create({ fromUser: from, toUser: toUserId });
        res.status(201).json({ message: "Request sent", connection: conn });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── POST /api/connections/accept ──────────────────────
// Accept an incoming connection request
router.post("/accept", authMiddleware, async (req, res) => {
    try {
        const userId = req.user;
        const { connectionId } = req.body;

        const conn = await Connection.findById(connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });

        if (conn.toUser.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized" });
        }

        conn.status = "accepted";
        await conn.save();

        res.status(200).json({ message: "Accepted", connection: conn });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── POST /api/connections/reject ──────────────────────
// Reject an incoming connection request
router.post("/reject", authMiddleware, async (req, res) => {
    try {
        const userId = req.user;
        const { connectionId } = req.body;

        const conn = await Connection.findById(connectionId);
        if (!conn) return res.status(404).json({ message: "Not found" });

        if (conn.toUser.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized" });
        }

        conn.status = "rejected";
        await conn.save();

        res.status(200).json({ message: "Rejected" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── GET /api/connections/requests ─────────────────────
// Get all pending requests sent TO me
router.get("/requests", authMiddleware, async (req, res) => {
    try {
        const userId = req.user;

        const requests = await Connection
            .find({ toUser: userId, status: "pending" })
            .populate("fromUser", "-password")
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json(requests);

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── GET /api/connections ──────────────────────────────
// Get all my accepted connections (for chats list)
router.get("/", authMiddleware, async (req, res) => {
    try {
        const userId = req.user;

        const connections = await Connection
            .find({
                $or: [{ fromUser: userId }, { toUser: userId }],
                status: "accepted",
            })
            .populate("fromUser", "-password")
            .populate("toUser", "-password")
            .lean();

        // Return the "other" user from each connection
        const others = connections.map(c => {
            const isMe = c.fromUser._id.toString() === userId.toString();
            return {
                connectionId: c._id,
                user: isMe ? c.toUser : c.fromUser,
                connectedAt: c.updatedAt,
            };
        });

        res.status(200).json(others);

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;