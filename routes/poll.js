const path = require("path");
const database = require(path.join(__dirname, "../database.js"));
const express = require("express");
const router = express.Router();
const check = require("express-validator/check");
const uidGen = new (require("uid-generator"))(256);
const bcrypt = require("bcrypt");
const sjcl = require("sjcl");

router.get("/poll/:id", [check.param("id").isNumeric()], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        try { 
            const record = await database.query({
                text: "SELECT polls.*, count(poll_votes.id) AS total_votes FROM polls \
                    LEFT JOIN poll_votes ON polls.id = poll_votes.poll_id WHERE polls.id=$1 \
                    GROUP BY polls.id",
                values: [req.params.id]
            });
            if (record.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            }
            const options = await database.query({
                text: "SELECT poll_options.id, poll_options.value, count(poll_votes.id) AS votes \
                FROM poll_options LEFT JOIN poll_votes ON poll_options.id = poll_votes.poll_option_id \
                WHERE poll_options.poll_id=$1 GROUP BY poll_options.id",
                values: [record.rows[0].id]
            });
            res.send({ 
                id: Number(record.rows[0].id),
                name: record.rows[0].name,
                description: record.rows[0].description,
                options: options.rows.map(e => { return { value: e.value, votes: Number(e.votes) } }),
                totalVotes: Number(record.rows[0].total_votes),
                created: record.rows[0].created
            });
        } catch (e) {
            console.log(e);
            res.status(500);
            res.send({ error: true });
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

router.delete("/poll/:id", [check.param("id").isNumeric()], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            const exists = (await client.query({
                text: "SELECT FROM polls WHERE id=$1",
                values: [req.params.id]
            })).rows.length === 1;
            if (!exists) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            }
            await client.query({
                text: "DELETE FROM polls WHERE id=$1",
                values: [req.params.id]
            });
            await client.query("COMMIT");
            res.send({ success: true, operation: "deletePoll", id: Number(req.params.id) });
        } catch (e) {
            await client.query("ROLLBACK");
            console.log(e);
            res.status(500);
            res.send({ error: true });
        } finally {
            client.release();
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

router.put("/poll/:id", [
    check.param("id").exists().isNumeric(),
    check.body("name").exists().isAscii().isLength({ max: 140 }),
    check.body("description").optional().isAscii().isLength({ max: 500 }),
    check.body("options").exists().custom((options) => {
        if (!Array.isArray(options) || options.length < 2) return false;
            let existing = [];
            for (let option of options) {
                if (option.length > 140 || existing.includes(option)) return false;
                existing.push(option);
            }
            return true;
    })
], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            const description = req.body.description ? req.body.description : "";
            const exists = (await client.query({
                text: "SELECT FROM polls WHERE id=$1",
                values: [req.params.id]
            })).rows.length === 1;
            if (!exists) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            }
            await client.query({
                text: "UPDATE polls SET name=$1, description=$2, modified=to_timestamp($3/1000.0) \
                WHERE id=$4",
                values: [req.body.name, description, Date.now(), req.params.id]
            });
            await client.query({
                text: "DELETE FROM poll_options WHERE NOT(value = ANY($1)) AND poll_id=$2",
                values: [req.body.options, req.params.id]
            });
            const remainingOptions = (await client.query({
                text: "SELECT value from poll_options WHERE poll_id=$1",
                values: [req.params.id]
            })).rows.map(row => row.value);
            for (let option of req.body.options.filter(e => !remainingOptions.includes(String(e)))) {
                await client.query({
                    text: "INSERT INTO poll_options (poll_id, value, created) \
                        VALUES ($1, $2, to_timestamp($3/1000.0))",
                    values: [req.params.id, option, Date.now()]
                });
            }
            await client.query("COMMIT");
            res.send({ 
                success: true, 
                operation: "updatePoll", 
                poll_id: Number(req.params.id),
            });
        } catch (e) {
            await client.query("ROLLBACK");
            console.log(e);
            res.status(500);
            res.send({ error: true });
        } finally {
            client.release();
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

router.post("/poll", [
        check.body("name").exists().isAscii().isLength({ max: 140 }),
        check.body("description").optional().isAscii().isLength({ max: 500 }),
        check.body("enforceUnique").exists().isBoolean(),
        check.body("options").exists().custom((options) => {
            if (!Array.isArray(options) || options.length < 2) return false;
            let existing = [];
            for (let option of options) {
                if (option.length > 140 || existing.includes(option)) return false;
                existing.push(option);
            }
            return true;
        })
    ], async (req, res) => {
        res.type("application/json");
        const errors = check.validationResult(req);
        if (errors.isEmpty()) {
            const client = await database.connect();
            try {
                await client.query("BEGIN");
                const now = Date.now();
                const editToken = await uidGen.generate();
                const editTokenHash = await bcrypt.hash(editToken, 12);
                const description = req.body.description ? req.body.description : "";
                const insertAndGetId = await client.query({
                    text: "INSERT INTO polls (name, description, edit_token, enforce_unique, \
                        created, modified) \
                        VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($5/1000.0)) \
                        RETURNING id",
                    values: [req.body.name, description, editTokenHash, req.body.enforceUnique, now]
                });
                for (let option of req.body.options) {
                    await client.query({
                        text: "INSERT INTO poll_options (poll_id, value, created) \
                            VALUES ($1, $2, to_timestamp($3 / 1000.0))",
                        values: [insertAndGetId.rows[0].id, option, Date.now()]
                    });
                }
                await client.query("COMMIT");
                res.send({ 
                    success: true, 
                    operation: "createPoll", 
                    poll_id: Number(insertAndGetId.rows[0].id),
                    editToken
                })
            } catch (e) {
                await client.query("ROLLBACK");
                console.log(e);
                res.status(500);
                res.send({ error: true });
            } finally {
                client.release();
            }
        } else {
            res.status(400);
            res.send({ error: true, details: errors.array() });
        }
});

router.post("/poll/:id/vote", [
    check.body("value").exists().isAscii().isLength({ max: 140 }),
], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            const poll = await client.query({
                text: "SELECT enforce_unique FROM polls WHERE id=$1",
                values: [req.params.id]
            });
            const option = await client.query({
                text: "SELECT id FROM poll_options WHERE poll_id=$1 AND value=$2",
                values: [req.params.id, req.body.value]
            });
            if (poll.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            } else if (option.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Option ${req.body.value} not found.`});
                return;
            }
            const enforceUnique = poll.rows[0].enforce_unique;
            const hash = sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(req.headers['x-forwarded-for'] 
                        || req.connection.remoteAddress));
            if (enforceUnique) {
                const alreadyVoted = (await client.query({
                    text: "SELECT id FROM poll_votes WHERE poll_id=$1 AND voter=$2",
                    values: [req.params.id, hash]
                })).rows.length >= 1;
                if (alreadyVoted) {
                    res.status(403);
                    res.send({ error: true, details: "You have already voted." })
                    return;
                }
            }
            await client.query({
                text: "INSERT INTO poll_votes (poll_id, poll_option_id, voter, created) \
                    VALUES ($1, $2, $3, to_timestamp($4/1000.0))",
                values: [req.params.id, option.rows[0].id, enforceUnique ? hash : null, Date.now()]
            });
            await client.query("COMMIT");
            res.send({ success: true, operation: "vote", poll_id: req.params.id });
        } catch (e) {
            await client.query("ROLLBACK");
            console.log(e);
            res.status(500);
            res.send({ error: true });
        } finally {
            client.release();
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

module.exports = router;