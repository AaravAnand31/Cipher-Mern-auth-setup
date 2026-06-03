const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");

const User           = require("../models/user");   // lowercase — matches filename
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


// ── REGISTER ─────────────────────────────────────────
router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(400).json({ message: "User already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);
        const user   = new User({ username, email, password: hashed });
        await user.save();

        res.status(201).json({ message: "User registered successfully" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── LOGIN ─────────────────────────────────────────────
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Invalid credentials" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: "Invalid credentials" });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        // Never send password to frontend
        const userObj = user.toObject();
        delete userObj.password;

        res.status(200).json({ token, user: userObj });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── CURRENT USER ──────────────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user).select("-password");
        res.status(200).json(user);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ── UPDATE PROFILE (called after /setup) ─────────────
router.put("/profile", authMiddleware, async (req, res) => {
    try {
        const { username, year, department, bio, icebreaker, interests, lookingFor, openTo } = req.body;

        const updates = { profileDone: true };
        if (username)              updates.username    = username;
        if (year)                  updates.year        = year;
        if (department)            updates.department  = department;
        if (bio)                   updates.bio         = bio;
        if (icebreaker !== undefined) updates.icebreaker = icebreaker;
        if (interests)             updates.interests   = interests;
        if (lookingFor)            updates.lookingFor  = lookingFor;
        if (openTo)                updates.openTo      = openTo;

        const user = await User.findByIdAndUpdate(
            req.user,
            { $set: updates },
            { new: true, select: "-password" }
        );

        res.status(200).json({ message: "Profile updated", user });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;