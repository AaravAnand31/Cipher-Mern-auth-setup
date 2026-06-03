const express    = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const User       = require("../models/user");
const Connection = require("../models/connection");

const router = express.Router();


// ── GET /api/users/discover ───────────────────────────
// Returns users to show on the discover page.
// Excludes: yourself + anyone you already have a connection with (any status)
router.get("/discover", authMiddleware, async (req, res) => {
    try {
        const me     = req.user;
        const limit  = parseInt(req.query.limit)  || 10;
        const skip   = parseInt(req.query.skip)   || 0;

        // Find all connection IDs that involve me
        const myConns = await Connection.find({
            $or: [{ fromUser: me }, { toUser: me }],
        }).lean();

        // Build list of user IDs to hide
        const hideIds = [
            me,
            ...myConns.map(c =>
                c.fromUser.toString() === me.toString() ? c.toUser : c.fromUser
            ),
        ];

        const users = await User
            .find({ _id: { $nin: hideIds } })
            .select("-password")
            .limit(limit)
            .skip(skip)
            .lean();

        res.status(200).json(users);

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── GET /api/users?search=term ────────────────────────
// Search users by name, interests, or department
router.get("/", authMiddleware, async (req, res) => {
    try {
        const me     = req.user;
        const search = req.query.search || "";
        const limit  = parseInt(req.query.limit) || 20;
        const skip   = parseInt(req.query.skip)  || 0;

        const filter = { _id: { $ne: me } };

        if (search) {
            filter.$or = [
                { username:   { $regex: search, $options: "i" } },
                { department: { $regex: search, $options: "i" } },
                { interests:  { $elemMatch: { $regex: search, $options: "i" } } },
            ];
        }

        const users = await User
            .find(filter)
            .select("-password")
            .limit(limit)
            .skip(skip)
            .lean();

        res.status(200).json(users);

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── GET /api/users/:id ────────────────────────────────
// Get a single user's profile
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password").lean();
        if (!user) return res.status(404).json({ message: "User not found" });
        res.status(200).json(user);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;