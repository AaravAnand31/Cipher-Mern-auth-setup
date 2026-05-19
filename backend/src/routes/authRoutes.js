const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


// ================= REGISTER =================

router.post("/register", async (req, res) => {

    try {

        const { username, email, password } = req.body;

        // check existing user
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(400).json({
                message: "User already exists",
            });
        }

        // hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // create user
        const user = new User({
            username,
            email,
            password: hashedPassword,
        });

        await user.save();

        res.status(201).json({
            message: "User registered successfully",
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            message: "Server error",
        });

    }

});


// ================= LOGIN =================

router.post("/login", async (req, res) => {

    try {

        const { email, password } = req.body;

        // find user
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({
                message: "Invalid credentials",
            });
        }

        // compare password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({
                message: "Invalid credentials",
            });
        }

        // create token
        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.status(200).json({
            token,
            user,
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            message: "Server error",
        });

    }

});


// ================= CURRENT USER =================

router.get("/me", authMiddleware, async (req, res) => {

    try {

        const user = await User.findById(req.user).select("-password");

        res.status(200).json(user);

    } catch (error) {

        console.log(error);

        res.status(500).json({
            message: "Server error",
        });

    }

});


module.exports = router;