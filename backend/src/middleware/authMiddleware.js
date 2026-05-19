const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {

    try {

        // get token from headers
        const token = req.header("Authorization");

        // check token
        if (!token) {
            return res.status(401).json({
                message: "No token, access denied",
            });
        }

        // verify token
        const verified = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // save user id in request
        req.user = verified.id;

        next();

    } catch (error) {

        res.status(401).json({
            message: "Invalid token",
        });

    }
};

module.exports = authMiddleware;