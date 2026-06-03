const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
    try {

        const authHeader = req.header("Authorization");

        if (!authHeader) {
            return res.status(401).json({ message: "No token, access denied" });
        }

        // Strip "Bearer " prefix if present
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : authHeader;

        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified.id;
        next();

    } catch (error) {
        res.status(401).json({ message: "Invalid token" });
    }
};

module.exports = authMiddleware;