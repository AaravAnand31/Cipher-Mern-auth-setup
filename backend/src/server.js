require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

console.log("Starting server...");

const authRoutes = require("./routes/authRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected");

        app.get("/", (req, res) => {
            res.send("Backend Running Successfully");
        });

        const PORT = process.env.PORT || 5500;

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.log("Mongo Error:");
        console.log(err);
    });