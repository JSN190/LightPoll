const path = require("path");
const database = require(path.join(__dirname, "../database.js"));
const express = require("express");
const router = express.Router();
const check = require("express-validator/check");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

router.post("/register", [
        check.body("username").exists().isAlphanumeric().isLength({ max: 30 }),
        check.body("password").exists().isAscii().isLength({ min: 8, max: 72 })
    ], async (req, res) => {
        res.type("application/json");
        const errors = check.validationResult(req);
        if (errors.isEmpty()) {
            const client = await database.connect();
            try {
                const exists = (await client.query({
                    text: "SELECT * FROM users WHERE username=$1",
                    values: [req.body.username.toLowerCase()]
                })).rows.length === 1;
                if (exists) {
                    res.status(403);
                    res.send({ error: true, details: `Username ${req.body.username} exists.`});
                    return;
                }
                const hash = await bcrypt.hash(String(req.body.password), 14);
                const user = await client.query({
                    text: "INSERT INTO users (username, display, pass_hash, created) \
                        VALUES ($1, $2, $3, to_timestamp($4/1000.0)) RETURNING *",
                    values: [req.body.username.toLowerCase(), req.body.username, hash, Date.now()]
                });
                await client.query("COMMIT");
                res.send({ 
                    success: true, 
                    operation: "register", 
                    id: Number(user.rows[0].id),
                    username: user.rows[0].display,
                    token: jwt.sign({ id: user.rows[0].id, username: user.rows[0].display }, process.env.LIGHTPOLL_JWT)
                });
            } catch (e) {
                console.log(e);
                res.status(500);
                res.send({ error: true })
            } finally {
                client.release();
            }
        } else {
            res.status(400);
            res.send({ error: true, details: errors.array() });
        }
});

module.exports = router;