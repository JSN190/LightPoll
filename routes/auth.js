const path = require("path");
const database = require(path.join(__dirname, "../database.js"));
const express = require("express");
const router = express.Router();
const check = require("express-validator/check");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

router.post("/login", [
        check.body("username").exists().isAlphanumeric().isLength({ max: 30 }),
        check.body("password").exists().isAscii().isLength({ min: 8, max: 72 })
    ], async (req, res) => {
        res.type("application/json");
        const errors = check.validationResult(req);
        if (errors.isEmpty()) {
            try {
                const user = await database.query({
                    text: "SELECT * FROM users WHERE username=$1",
                    values: [req.body.username.toLowerCase()]
                });
                if (user.rows.length !== 1) {
                    res.status(404);
                    res.send({ error: true, details: `Username ${req.body.username} not found.`});
                    return;
                }
                const correctPassword = await bcrypt.compare(req.body.password, user.rows[0].pass_hash);
                if (correctPassword) {
                    res.send({
                        success: true,
                        operation: "login",
                        user: {
                            id: Number(user.rows[0].id),
                            username: user.rows[0].display
                        },
                        token: jwt.sign({ id: Number(user.rows[0].id), username: user.rows[0].display }, 
                            process.env.LIGHTPOLL_JWT, { expiresIn: "30 days" })
                    });
                } else {
                    res.status(401);
                    res.send({ error: true, details: `Incorrect password.`});
                    return;
                }
            } catch (e) {
                console.log(e);
                res.status(500);
                res.send({ error: true })
            }
        } else {
            res.status(400);
            res.send({ error: true, details: errors.array() });
        }
});

router.post("/register", [
        check.body("username").exists().isAlphanumeric().isLength({ max: 30 }),
        check.body("password").exists().isAscii().isLength({ min: 8, max: 72 })
    ], async (req, res) => {
        res.type("application/json");
        const errors = check.validationResult(req);
        if (errors.isEmpty()) {
            const client = await database.connect();
            try {
                await client.query("BEGIN");
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
                    user: {
                        id: Number(user.rows[0].id),
                        username: user.rows[0].display,
                    },
                    token: jwt.sign({ id: Number(user.rows[0].id), username: user.rows[0].display }, 
                        process.env.LIGHTPOLL_JWT, { expiresIn: "30 days" })
                });
            } catch (e) {
                console.log(e);
                await client.query("ROLLBACK");
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

router.put("/password", [
    check.body("username").exists().isAlphanumeric().isLength({ max: 30 }),
    check.body("currentPassword").exists().isAscii().isLength({ min: 8, max: 72 }),
    check.body("newPassword").exists().isAscii().isLength({ min: 8, max: 72 })
], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            const user = await client.query({
                text: "SELECT * FROM users WHERE username=$1",
                values: [req.body.username.toLowerCase()]
            });
            if (user.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Username ${req.body.username} not found.`});
                return;
            }
            const correctPassword = await bcrypt.compare(req.body.currentPassword, user.rows[0].pass_hash);
            if (correctPassword) {
                const hash = await bcrypt.hash(String(req.body.newPassword), 14);
                await client.query({
                    text: "UPDATE users SET pass_hash=$1 WHERE username=$2",
                    values: [hash, req.body.username.toLowerCase()]
                });
                await client.query("COMMIT");
                res.send({
                    success: true,
                    operation: "changePassword",
                    user: {
                        id: Number(user.rows[0].id),
                        username: user.rows[0].display
                    },
                    token: jwt.sign({ id: Number(user.rows[0].id), username: user.rows[0].display }, 
                        process.env.LIGHTPOLL_JWT, { expiresIn: "30 days" })
                });
            } else {
                res.status(401);
                res.send({ error: true, details: `Incorrect current password.`});
            }
        } catch (e) {
            console.log(e);
            client.query("ROLLBACK");
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