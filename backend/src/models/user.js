const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    // ── Auth fields ──────────────────────────────────
    username: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },

    // ── Profile fields (filled in /setup) ───────────
    year: {
        type: String,
        default: '',
    },
    department: {
        type: String,
        default: '',
    },
    bio: {
        type: String,
        default: '',
    },
    icebreaker: {
        type: String,
        default: '',
    },
    interests: {
        type: [String],
        default: [],
    },
    lookingFor: {
        type: [String],
        default: [],
    },
    openTo: {
        type: [String],
        default: ['Everyone'],
    },
    photoURL: {
        type: String,
        default: '',
    },
    coverURL: {
        type: String,
        default: '',
    },
    profileDone: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);