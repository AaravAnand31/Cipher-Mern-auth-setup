require("dotenv").config();

const express    = require("express");
const mongoose   = require("mongoose");
const cors       = require("cors");

console.log("Starting server...");

const authRoutes       = require("./routes/authRoutes");
const userRoutes       = require("./routes/userRoutes");        // NEW
const connectionRoutes = require("./routes/connectionRoutes");  // NEW

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth",        authRoutes);
app.use("/api/users",       userRoutes);        // NEW
app.use("/api/connections", connectionRoutes);  // NEW

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
        console.log("Mongo Error:", err);
    });