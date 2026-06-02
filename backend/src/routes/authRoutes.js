const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/user");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


// ================= REGISTER =================

router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();

        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});


// ================= LOGIN =================

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        // Return user WITHOUT password
        const userObj = user.toObject();
        delete userObj.password;

        res.status(200).json({ token, user: userObj });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});


// ================= CURRENT USER =================

router.get("/me", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user).select("-password");
        res.status(200).json(user);
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});


// ================= UPDATE PROFILE =================
// Called after /setup to save year, dept, bio, interests etc.

router.put("/profile", authMiddleware, async (req, res) => {
    try {
        const { username, year, department, bio, icebreaker, interests, lookingFor, openTo } = req.body;

        const updates = {};
        if (username)    updates.username    = username;
        if (year)        updates.year        = year;
        if (department)  updates.department  = department;
        if (bio)         updates.bio         = bio;
        if (icebreaker !== undefined) updates.icebreaker = icebreaker;
        if (interests)   updates.interests   = interests;
        if (lookingFor)  updates.lookingFor  = lookingFor;
        if (openTo)      updates.openTo      = openTo;
        updates.profileDone = true;

        const user = await User.findByIdAndUpdate(
            req.user,
            { $set: updates },
            { new: true, select: '-password' }
        );

        res.status(200).json({ message: "Profile updated", user });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;